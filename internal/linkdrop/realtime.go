package linkdrop

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

const (
	realtimeProtocol = "linkdrop.v3"
	pingInterval     = 30 * time.Second
	writeTimeout     = 10 * time.Second
)

// realtime authenticates before upgrading: the endpoint key travels as a second
// WebSocket subprotocol because browsers cannot set headers on the handshake.
func (s *Server) realtime(w http.ResponseWriter, r *http.Request) {
	if !s.trackConn() {
		writeError(w, errShuttingDown)
		return
	}
	// Shutdown waits for this; it is released once the final message is written,
	// without waiting for the peer to acknowledge the close.
	released := sync.OnceFunc(s.conns.Done)
	defer released()
	key, ok := realtimeKey(r)
	if !ok {
		writeError(w, errUnauthorized)
		return
	}
	query := r.URL.Query()
	var sub *subscriber
	var err *apiError
	switch {
	case query.Get("sessionId") != "":
		sub, err = s.store.subscribeSession(query.Get("sessionId"), key)
	case query.Get("pairingToken") != "":
		sub, err = s.store.subscribePairing(query.Get("pairingToken"), key)
	default:
		err = errUnauthorized
	}
	if err != nil {
		writeError(w, err)
		return
	}
	defer s.store.unsubscribe(sub)

	conn, acceptErr := websocket.Accept(w, r, &websocket.AcceptOptions{
		Subprotocols: []string{realtimeProtocol},
		// Authorization is the explicit endpoint key, never an ambient cookie, so a
		// cross-origin page gains nothing. Skipping the Origin check keeps reverse
		// proxies that rewrite Host working.
		InsecureSkipVerify: true,
	})
	if acceptErr != nil {
		return
	}
	defer conn.CloseNow()
	ctx := conn.CloseRead(context.Background())
	ping := time.NewTicker(pingInterval)
	defer ping.Stop()
	for {
		select {
		case msg, open := <-sub.send:
			if !open {
				released()
				conn.Close(websocket.StatusNormalClosure, "")
				return
			}
			if writeMessage(ctx, conn, msg) != nil {
				return
			}
		case <-ping.C:
			pingCtx, cancel := context.WithTimeout(ctx, writeTimeout)
			err := conn.Ping(pingCtx)
			cancel()
			if err != nil {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

func writeMessage(ctx context.Context, conn *websocket.Conn, msg []byte) error {
	ctx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()
	return conn.Write(ctx, websocket.MessageText, msg)
}

func realtimeKey(r *http.Request) (string, bool) {
	var key string
	versioned := false
	for _, header := range r.Header.Values("sec-websocket-protocol") {
		for _, protocol := range strings.Split(header, ",") {
			protocol = strings.TrimSpace(protocol)
			switch {
			case protocol == realtimeProtocol:
				versioned = true
			case protocol != "" && key == "":
				key = protocol
			}
		}
	}
	return key, versioned && key != ""
}

const (
	reasonEnded         = "ended"
	reasonExpired       = "expired"
	reasonServerRestart = "server_restart"
	reasonReplaced      = "replaced"

	// subscriberBuffer bounds how far a slow connection may fall behind before it is
	// dropped. Every session message is a full snapshot, so a reconnect loses nothing.
	subscriberBuffer = 16
	// maxSubscribersPerKey allows a few tabs per endpoint; a newer connection closes the oldest.
	maxSubscribersPerKey = 4
)

var subscriberSeq atomic.Uint64

var messagePairingExpired = []byte(`{"type":"pairing_expired"}`)

// subscriber is one realtime connection. The store only touches it while holding its
// lock; the connection goroutine just drains send until it is closed.
type subscriber struct {
	key    string
	seq    uint64
	send   chan []byte
	owner  subscribers
	closed bool
}

type subscribers map[*subscriber]struct{}

func newSubscriber(key string) *subscriber {
	return &subscriber{key: key, seq: subscriberSeq.Add(1), send: make(chan []byte, subscriberBuffer)}
}

func (sub *subscriber) push(msg []byte) {
	if sub.closed {
		return
	}
	select {
	case sub.send <- msg:
	default:
		sub.close()
	}
}

func (sub *subscriber) finish(msg []byte) {
	if msg != nil {
		sub.push(msg)
	}
	sub.close()
}

func (sub *subscriber) close() {
	if sub.closed {
		return
	}
	sub.closed = true
	close(sub.send)
	if sub.owner != nil {
		delete(sub.owner, sub)
	}
}

func (set *subscribers) add(sub *subscriber) {
	if *set == nil {
		*set = subscribers{}
	}
	(*set)[sub] = struct{}{}
	sub.owner = *set
	var oldest *subscriber
	count := 0
	for other := range *set {
		if other.key == sub.key {
			count++
			if oldest == nil || other.seq < oldest.seq {
				oldest = other
			}
		}
	}
	if count > maxSubscribersPerKey {
		oldest.close()
	}
}

func (set subscribers) finish(msg []byte) {
	for sub := range set {
		sub.finish(msg)
	}
}

func (set subscribers) finishKey(key string, msg []byte) {
	for sub := range set {
		if sub.key == key {
			sub.finish(msg)
		}
	}
}

func encodeSnapshot(view sessionView) []byte {
	view.Type = "session"
	return mustJSON(view)
}

func encodeEnded(reason string) []byte {
	return mustJSON(map[string]string{"type": "session_ended", "reason": reason})
}

func encodePaired(p *pairingToken) []byte {
	return mustJSON(map[string]string{"type": "paired", "sessionId": p.sessionID, "endpointKey": p.screenKey, "role": string(RoleScreen)})
}

func mustJSON(v any) []byte {
	data, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return data
}
