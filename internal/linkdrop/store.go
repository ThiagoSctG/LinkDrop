package linkdrop

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"slices"
	"sync"
	"time"
)

type Role string

const (
	RoleScreen Role = "screen"
	RolePhone  Role = "phone"
)

type pairingToken struct {
	token           string
	screenKey       string
	expiresAt       time.Time
	sessionID       string
	rejoinSessionID string
	subscribers     subscribers
}

type session struct {
	id           string
	pairingToken string
	rejoinToken  string
	lastActivity time.Time
	endpoints    map[string]Role
	items        []Item // newest first
	itemBytes    int
	subscribers  subscribers
}

// maxSessionBytes bounds the ciphertext one session holds, whatever its item count.
const maxSessionBytes = 2 << 20

func itemSize(item Item) int { return len(item.Encrypted.IV) + len(item.Encrypted.Data) }

// store owns every piece of LinkDrop state, including who is listening for changes.
// All methods are safe for concurrent use; notifications are queued under the same
// lock as the mutation that caused them, so subscribers never miss or reorder events.
type store struct {
	mu          sync.Mutex
	now         func() time.Time
	sessionTTL  time.Duration
	pairingTTL  time.Duration
	maxItems    int
	maxSessions int
	pairings    map[string]*pairingToken
	sessions    map[string]*session
}

func newStore(cfg Config) *store {
	return &store{
		now:         cfg.Now,
		sessionTTL:  cfg.SessionTTL,
		pairingTTL:  cfg.PairingTTL,
		maxItems:    cfg.MaxItemsPerSession,
		maxSessions: cfg.MaxSessions,
		pairings:    map[string]*pairingToken{},
		sessions:    map[string]*session{},
	}
}

func opaqueID() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	const hex = "0123456789abcdef"
	out := make([]byte, 0, 36)
	for i, v := range b {
		if i == 4 || i == 6 || i == 8 || i == 10 {
			out = append(out, '-')
		}
		out = append(out, hex[v>>4], hex[v&0x0f])
	}
	return string(out)
}

// Pairing

// newPairing is a freshly issued Pairing token as the Screen that shows its QR code sees it.
type newPairing struct {
	Token     string    `json:"token"`
	ScreenKey string    `json:"screenKey"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func (p *pairingToken) issued() newPairing {
	return newPairing{Token: p.token, ScreenKey: p.screenKey, ExpiresAt: p.expiresAt.UTC()}
}

func (s *store) createScreen() (newPairing, *apiError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Paired sessions keep their tokens, so this also bounds unscanned QR codes.
	if len(s.sessions) >= s.maxSessions || len(s.pairings) >= 2*s.maxSessions {
		return newPairing{}, errServerBusy
	}
	p := &pairingToken{token: opaqueID(), screenKey: opaqueID(), expiresAt: s.now().Add(s.pairingTTL)}
	s.pairings[p.token] = p
	return p.issued(), nil
}

// createRejoinPairing issues a Pairing token that lets a new Phone replace the Session's
// current one. Only the Screen may ask, and asking is Activity. It replaces any earlier
// replacement token.
func (s *store) createRejoinPairing(id, key string) (newPairing, *apiError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, role, err := s.lookup(id, key)
	if err != nil {
		return newPairing{}, err
	}
	if role != RoleScreen {
		return newPairing{}, errScreenOnly
	}
	s.dropRejoinPairing(sess)
	p := &pairingToken{
		token:           opaqueID(),
		screenKey:       key,
		expiresAt:       s.now().Add(s.pairingTTL),
		rejoinSessionID: sess.id,
	}
	s.pairings[p.token] = p
	sess.rejoinToken = p.token
	s.changed(sess)
	return p.issued(), nil
}

// dropRejoinPairing removes the Session's replacement token, if any. An unscanned one
// tells the Screen waiting on it that it expired; a scanned one has served its purpose.
// Callers must hold s.mu.
func (s *store) dropRejoinPairing(sess *session) {
	p, ok := s.pairings[sess.rejoinToken]
	if !ok {
		return
	}
	if p.sessionID == "" {
		s.expirePairing(p)
	} else {
		delete(s.pairings, p.token)
	}
}

type pairedPhone struct {
	SessionID   string `json:"sessionId"`
	EndpointKey string `json:"endpointKey"`
	Role        Role   `json:"role"`
}

func (s *store) pair(token string) (pairedPhone, *apiError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.livePairing(token)
	if err != nil {
		return pairedPhone{}, errQRExpired
	}
	if p.sessionID != "" {
		return pairedPhone{}, errQRUsed
	}
	if p.rejoinSessionID != "" {
		sess, ok := s.sessions[p.rejoinSessionID]
		if !ok || s.expired(sess) {
			if ok {
				s.endSession(sess, reasonExpired)
			}
			s.expirePairing(p)
			return pairedPhone{}, errPairingGone
		}
		var oldPhoneKey string
		for k, r := range sess.endpoints {
			if r == RolePhone {
				oldPhoneKey = k
				break
			}
		}
		if oldPhoneKey != "" {
			delete(sess.endpoints, oldPhoneKey)
			sess.subscribers.finishKey(oldPhoneKey, encodeEnded(reasonReplaced))
		}
		phoneKey := opaqueID()
		sess.endpoints[phoneKey] = RolePhone
		p.sessionID = sess.id
		p.subscribers.finish(encodePaired(p))
		s.changed(sess)
		return pairedPhone{SessionID: sess.id, EndpointKey: phoneKey, Role: RolePhone}, nil
	}
	if len(s.sessions) >= s.maxSessions {
		return pairedPhone{}, errServerBusy
	}
	phoneKey := opaqueID()
	sess := &session{
		id:           newUUID(),
		pairingToken: token,
		lastActivity: s.now(),
		endpoints:    map[string]Role{p.screenKey: RoleScreen, phoneKey: RolePhone},
	}
	s.sessions[sess.id] = sess
	p.sessionID = sess.id
	p.subscribers.finish(encodePaired(p))
	return pairedPhone{SessionID: sess.id, EndpointKey: phoneKey, Role: RolePhone}, nil
}

// livePairing returns a usable token, dropping it if it expired before being scanned.
// Callers must hold s.mu.
func (s *store) livePairing(token string) (*pairingToken, *apiError) {
	p, ok := s.pairings[token]
	if !ok {
		return nil, errPairingGone
	}
	if p.expiredUnscanned(s.now()) {
		s.expirePairing(p)
		return nil, errPairingGone
	}
	return p, nil
}

// expiredUnscanned reports a token nobody scanned in time. A scanned token lives
// as long as its session.
func (p *pairingToken) expiredUnscanned(now time.Time) bool {
	return p.sessionID == "" && !now.Before(p.expiresAt)
}

func (s *store) expirePairing(p *pairingToken) {
	delete(s.pairings, p.token)
	p.subscribers.finish(messagePairingExpired)
}

type pairingState struct {
	Status      string `json:"status"`
	SessionID   string `json:"sessionId,omitempty"`
	EndpointKey string `json:"endpointKey,omitempty"`
	Role        Role   `json:"role,omitempty"`
}

func (s *store) pairingState(token, screenKey string) (pairingState, *apiError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.screenPairing(token, screenKey)
	if err != nil {
		return pairingState{}, err
	}
	if p.sessionID != "" {
		return pairingState{Status: "paired", SessionID: p.sessionID, EndpointKey: p.screenKey, Role: RoleScreen}, nil
	}
	return pairingState{Status: "waiting"}, nil
}

func (s *store) screenPairing(token, screenKey string) (*pairingToken, *apiError) {
	p, err := s.livePairing(token)
	if err != nil {
		return nil, err
	}
	if subtle.ConstantTimeCompare([]byte(p.screenKey), []byte(screenKey)) != 1 {
		return nil, errForbidden
	}
	return p, nil
}

// subscribePairing lets the screen wait for its phone. A token that is already
// paired answers immediately.
func (s *store) subscribePairing(token, screenKey string) (*subscriber, *apiError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.screenPairing(token, screenKey)
	if err != nil {
		return nil, err
	}
	sub := newSubscriber(screenKey)
	if p.sessionID != "" {
		sub.finish(encodePaired(p))
		return sub, nil
	}
	p.subscribers.add(sub)
	return sub, nil
}

// Sessions

type sessionView struct {
	Type  string `json:"type,omitempty"`
	ID    string `json:"id"`
	Role  Role   `json:"role"`
	Items []Item `json:"items"`
	// ExpiresInMs is how long the session survives without explicit activity. A duration, not a
	// timestamp, so devices with a skewed clock still count down correctly.
	ExpiresInMs int64 `json:"expiresInMs"`
}

// lookup resolves a session for an endpoint, ending it first if it went idle.
// Callers must hold s.mu.
func (s *store) lookup(id, key string) (*session, Role, *apiError) {
	sess, ok := s.sessions[id]
	if !ok {
		return nil, "", errSessionGone
	}
	if s.expired(sess) {
		s.endSession(sess, reasonExpired)
		return nil, "", errSessionGone
	}
	role, ok := sess.endpoints[key]
	if !ok {
		return nil, "", errForbidden
	}
	return sess, role, nil
}

func (s *store) authorize(id, key string) *apiError {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, _, err := s.lookup(id, key)
	return err
}

func (s *store) view(id, key string) (sessionView, *apiError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, role, err := s.lookup(id, key)
	if err != nil {
		return sessionView{}, err
	}
	return s.snapshot(sess, role), nil
}

func (s *store) snapshot(sess *session, role Role) sessionView {
	left := sess.lastActivity.Add(s.sessionTTL).Sub(s.now())
	return sessionView{ID: sess.id, Role: role, Items: append([]Item{}, sess.items...), ExpiresInMs: max(left, 0).Milliseconds()}
}

func (s *store) subscribeSession(id, key string) (*subscriber, *apiError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, role, err := s.lookup(id, key)
	if err != nil {
		return nil, err
	}
	sub := newSubscriber(key)
	sub.push(encodeSnapshot(s.snapshot(sess, role)))
	sess.subscribers.add(sub)
	return sub, nil
}

// changed records explicit activity and pushes a fresh snapshot to every endpoint.
// Each role's snapshot is encoded once and shared by its connections.
// Callers must hold s.mu.
func (s *store) changed(sess *session) {
	sess.lastActivity = s.now()
	encoded := map[Role][]byte{}
	for sub := range sess.subscribers {
		role := sess.endpoints[sub.key]
		if encoded[role] == nil {
			encoded[role] = encodeSnapshot(s.snapshot(sess, role))
		}
		sub.push(encoded[role])
	}
}

func (s *store) addItem(id, key string, d draft) (Item, *apiError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, _, err := s.lookup(id, key)
	if err != nil {
		return Item{}, err
	}
	item := Item{ID: d.ID, Encrypted: d.Encrypted, CreatedAt: s.now().UTC()}
	if len(sess.items) >= s.maxItems || sess.itemBytes+itemSize(item) > maxSessionBytes {
		return Item{}, errSessionFull
	}
	// IDs are authenticated as AES-GCM associated data on the devices.
	for _, existing := range sess.items {
		if existing.ID == d.ID {
			return Item{}, errInvalidRequest
		}
	}
	sess.items = slices.Insert(sess.items, 0, item)
	sess.itemBytes += itemSize(item)
	s.changed(sess)
	return item, nil
}

func (s *store) removeItem(id, key, itemID string) *apiError {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, _, err := s.lookup(id, key)
	if err != nil {
		return err
	}
	sess.items = slices.DeleteFunc(sess.items, func(item Item) bool {
		if item.ID != itemID {
			return false
		}
		sess.itemBytes -= itemSize(item)
		return true
	})
	s.changed(sess)
	return nil
}

func (s *store) clear(id, key string) *apiError {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, role, err := s.lookup(id, key)
	if err != nil {
		return err
	}
	if role != RoleScreen {
		return errScreenOnly
	}
	sess.items = nil
	sess.itemBytes = 0
	s.changed(sess)
	return nil
}

func (s *store) touch(id, key string) *apiError {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, _, err := s.lookup(id, key)
	if err != nil {
		return err
	}
	s.changed(sess) // renews activity and gives both endpoints the new deadline
	return nil
}

func (s *store) end(id, key string) *apiError {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, _, err := s.lookup(id, key)
	if err != nil {
		return err
	}
	s.endSession(sess, reasonEnded)
	return nil
}

func (s *store) expired(sess *session) bool {
	return !s.now().Before(sess.lastActivity.Add(s.sessionTTL))
}

// endSession deletes a session with its items and pairing tokens and tells its endpoints.
// Callers must hold s.mu.
func (s *store) endSession(sess *session, reason string) {
	delete(s.sessions, sess.id)
	delete(s.pairings, sess.pairingToken)
	s.dropRejoinPairing(sess)
	sess.subscribers.finish(encodeEnded(reason))
}

// sweep removes unscanned tokens and idle sessions.
func (s *store) sweep() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	for _, p := range s.pairings {
		if p.expiredUnscanned(now) {
			s.expirePairing(p)
		}
	}
	for _, sess := range s.sessions {
		if s.expired(sess) {
			s.endSession(sess, reasonExpired)
		}
	}
}

// shutdown ends every session, since state does not survive the process.
func (s *store) shutdown() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, sess := range s.sessions {
		s.endSession(sess, reasonServerRestart)
	}
	for _, p := range s.pairings {
		p.subscribers.finish(nil)
	}
}

func (s *store) unsubscribe(sub *subscriber) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sub.close()
}
