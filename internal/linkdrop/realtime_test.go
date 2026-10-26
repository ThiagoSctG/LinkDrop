package linkdrop_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/ThiagoSctG/LinkDrop/internal/linkdrop"
)

type message struct {
	Type        string `json:"type"`
	Reason      string `json:"reason"`
	ID          string `json:"id"`
	Role        string `json:"role"`
	Items       []item `json:"items"`
	ExpiresInMs int64  `json:"expiresInMs"`
	SessionID   string `json:"sessionId"`
	EndpointKey string `json:"endpointKey"`
	raw         string
}

type socket struct {
	t    *testing.T
	conn *websocket.Conn
}

func (h *harness) dial(query url.Values, protocols ...string) (*socket, *http.Response, error) {
	h.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	target := "ws" + strings.TrimPrefix(h.server.URL, "http") + "/api/realtime?" + query.Encode()
	conn, res, err := websocket.Dial(ctx, target, &websocket.DialOptions{Subprotocols: protocols})
	if err != nil {
		return nil, res, err
	}
	s := &socket{t: h.t, conn: conn}
	h.t.Cleanup(func() { conn.CloseNow() })
	return s, res, nil
}

func (h *harness) mustDial(query url.Values, key string) *socket {
	h.t.Helper()
	s, _, err := h.dial(query, "linkdrop.v3", key)
	if err != nil {
		h.t.Fatalf("dial: %v", err)
	}
	if s.conn.Subprotocol() != "linkdrop.v3" {
		h.t.Fatalf("subprotocol = %q", s.conn.Subprotocol())
	}
	return s
}

func sessionQuery(sess session) url.Values { return url.Values{"sessionId": {sess.phone.SessionID}} }

func (s *socket) next() message {
	s.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, data, err := s.conn.Read(ctx)
	if err != nil {
		s.t.Fatalf("read: %v", err)
	}
	var m message
	if err := json.Unmarshal(data, &m); err != nil {
		s.t.Fatalf("decode %q: %v", data, err)
	}
	m.raw = string(data)
	return m
}

func (s *socket) expectClosed() {
	s.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, data, err := s.conn.Read(ctx)
	if err == nil {
		s.t.Fatalf("expected close, got %q", data)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		s.t.Fatal("socket stayed open")
	}
}

func TestRealtimeRejectsUnauthenticatedConnections(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	cases := []struct {
		name      string
		query     url.Values
		protocols []string
		status    int
	}{
		{"no key", sessionQuery(sess), []string{"linkdrop.v3"}, http.StatusUnauthorized},
		{"no protocol", sessionQuery(sess), []string{sess.phone.EndpointKey}, http.StatusUnauthorized},
		{"old protocol", sessionQuery(sess), []string{"linkdrop.v1", sess.phone.EndpointKey}, http.StatusUnauthorized},
		{"plaintext protocol", sessionQuery(sess), []string{"linkdrop.v2", sess.phone.EndpointKey}, http.StatusUnauthorized},
		{"wrong key", sessionQuery(sess), []string{"linkdrop.v3", "guess"}, http.StatusForbidden},
		{"unknown session", url.Values{"sessionId": {"nope"}}, []string{"linkdrop.v3", sess.phone.EndpointKey}, http.StatusNotFound},
		{"no target", url.Values{}, []string{"linkdrop.v3", sess.phone.EndpointKey}, http.StatusUnauthorized},
		{"wrong pairing key", url.Values{"pairingToken": {sess.screen.Token}}, []string{"linkdrop.v3", "guess"}, http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, res, err := h.dial(tc.query, tc.protocols...)
			if err == nil {
				t.Fatal("connection accepted")
			}
			if res == nil || res.StatusCode != tc.status {
				t.Fatalf("response = %+v, want %d", res, tc.status)
			}
		})
	}
}

func TestRealtimeSendsSnapshotOnConnect(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	h.addItem(sess, sess.phoneHeaders(), encryptedDraft())
	m := h.mustDial(sessionQuery(sess), sess.phone.EndpointKey).next()
	if m.Type != "session" || m.ID != sess.phone.SessionID || m.Role != "phone" || len(m.Items) != 1 || m.Items[0].Encrypted.Version != 1 {
		t.Fatalf("snapshot = %s", m.raw)
	}
}

func TestEmptySnapshotHasAnItemsArray(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	m := h.mustDial(sessionQuery(sess), sess.screen.ScreenKey).next()
	if !strings.Contains(m.raw, `"items":[]`) || m.Role != "screen" {
		t.Fatalf("snapshot = %s", m.raw)
	}
}

func TestRealtimePushesSnapshotsToBothEndpoints(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	phone := h.mustDial(sessionQuery(sess), sess.phone.EndpointKey)
	screen := h.mustDial(sessionQuery(sess), sess.screen.ScreenKey)
	phone.next()
	screen.next()

	created := decode[item](t, h.addItem(sess, sess.screenHeaders(), encryptedDraft()))
	for _, s := range []*socket{phone, screen} {
		m := s.next()
		if m.Type != "session" || len(m.Items) != 1 || m.Items[0].ID != created.ID {
			t.Fatalf("after add = %s", m.raw)
		}
	}
}

func TestRealtimeAnnouncesEndToBothEndpoints(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	phone := h.mustDial(sessionQuery(sess), sess.phone.EndpointKey)
	screen := h.mustDial(sessionQuery(sess), sess.screen.ScreenKey)
	phone.next()
	screen.next()
	expectStatus(t, h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/end", sess.screenHeaders(), nil), http.StatusNoContent)
	for _, s := range []*socket{phone, screen} {
		if m := s.next(); m.Type != "session_ended" || m.Reason != "ended" {
			t.Fatalf("message = %s", m.raw)
		}
		s.expectClosed()
	}
}

func TestSweepExpiresIdleSessionsAndTellsEndpoints(t *testing.T) {
	h := newHarness(t, func(c *linkdrop.Config) { c.SweepInterval = 10 * time.Millisecond })
	sess := h.createSession()
	phone := h.mustDial(sessionQuery(sess), sess.phone.EndpointKey)
	phone.next()
	h.clock.Advance(30 * time.Minute)
	if m := phone.next(); m.Type != "session_ended" || m.Reason != "expired" {
		t.Fatalf("message = %s", m.raw)
	}
	phone.expectClosed()
}

func TestScreenIsToldWhenAPhonePairs(t *testing.T) {
	h := newHarness(t)
	s := h.createScreen()
	screen := h.mustDial(url.Values{"pairingToken": {s.Token}}, s.ScreenKey)
	phone := decode[pairing](t, h.do("POST", "/api/pair/"+s.Token, nil, nil))
	m := screen.next()
	if m.Type != "paired" || m.SessionID != phone.SessionID || m.EndpointKey != s.ScreenKey || m.Role != "screen" {
		t.Fatalf("message = %s", m.raw)
	}
}

func TestScreenThatReconnectsAfterPairingIsToldImmediately(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	m := h.mustDial(url.Values{"pairingToken": {sess.screen.Token}}, sess.screen.ScreenKey).next()
	if m.Type != "paired" || m.SessionID != sess.phone.SessionID {
		t.Fatalf("message = %s", m.raw)
	}
}

func TestScreenIsToldWhenItsQRExpires(t *testing.T) {
	h := newHarness(t, func(c *linkdrop.Config) { c.SweepInterval = 10 * time.Millisecond })
	s := h.createScreen()
	screen := h.mustDial(url.Values{"pairingToken": {s.Token}}, s.ScreenKey)
	h.clock.Advance(2 * time.Minute)
	if m := screen.next(); m.Type != "pairing_expired" {
		t.Fatalf("message = %s", m.raw)
	}
	screen.expectClosed()
}

func TestShutdownEndsOpenSessions(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	phone := h.mustDial(sessionQuery(sess), sess.phone.EndpointKey)
	phone.next()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	// Shutdown returns only after every realtime connection has flushed its final message.
	if err := h.app.Shutdown(ctx); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	if m := phone.next(); m.Type != "session_ended" || m.Reason != "server_restart" {
		t.Fatalf("message = %s", m.raw)
	}
	phone.expectClosed()
}

func TestSnapshotReportsTimeLeftUntilInactivityExpiry(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	const ttl = 30 * time.Minute
	if m := h.mustDial(sessionQuery(sess), sess.phone.EndpointKey).next(); m.ExpiresInMs != ttl.Milliseconds() {
		t.Fatalf("fresh session expiresInMs = %d, want %d", m.ExpiresInMs, ttl.Milliseconds())
	}

	h.clock.Advance(10 * time.Minute)
	late := h.mustDial(sessionQuery(sess), sess.phone.EndpointKey).next()
	if want := (20 * time.Minute).Milliseconds(); late.ExpiresInMs != want {
		t.Fatalf("after 10 idle minutes expiresInMs = %d, want %d (reconnecting is not activity)", late.ExpiresInMs, want)
	}
}

func TestActivityPushesAFreshDeadlineToBothEndpoints(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	phone := h.mustDial(sessionQuery(sess), sess.phone.EndpointKey)
	screen := h.mustDial(sessionQuery(sess), sess.screen.ScreenKey)
	phone.next()
	screen.next()

	h.clock.Advance(20 * time.Minute)
	expectStatus(t, h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/activity", sess.phoneHeaders(), nil), http.StatusNoContent)
	for _, s := range []*socket{phone, screen} {
		if m := s.next(); m.Type != "session" || m.ExpiresInMs != (30*time.Minute).Milliseconds() {
			t.Fatalf("after activity = %s", m.raw)
		}
	}
}
