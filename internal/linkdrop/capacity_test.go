package linkdrop_test

import (
	"encoding/base64"
	"net/http"
	"testing"

	"github.com/ThiagoSctG/LinkDrop/internal/linkdrop"
)

func TestServerRefusesNewSessionsAtCapacity(t *testing.T) {
	h := newHarness(t, func(c *linkdrop.Config) { c.MaxSessions = 1 })
	first := h.createScreen()
	second := h.createScreen()
	res := h.do("POST", "/api/pair/"+first.Token, nil, nil)
	expectStatus(t, res, http.StatusCreated)
	phone := decode[pairing](t, res)

	expectCode(t, h.do("POST", "/api/pair/"+second.Token, nil, nil), http.StatusServiceUnavailable, "server_busy")
	expectCode(t, h.do("POST", "/api/screens", nil, nil), http.StatusServiceUnavailable, "server_busy")

	expectStatus(t, h.do("POST", "/api/sessions/"+phone.SessionID+"/end", map[string]string{"x-endpoint-key": phone.EndpointKey}, nil), http.StatusNoContent)
	h.createScreen()
}

func TestUnscannedQRCodesAreBounded(t *testing.T) {
	h := newHarness(t, func(c *linkdrop.Config) { c.MaxSessions = 1 })
	h.createScreen()
	h.createScreen()
	expectCode(t, h.do("POST", "/api/screens", nil, nil), http.StatusServiceUnavailable, "server_busy")
}

func TestSessionHasAByteLimit(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	added := 0
	for {
		d := encryptedDraft()
		d["encrypted"].(map[string]any)["data"] = base64.RawURLEncoding.EncodeToString(make([]byte, 65_536))
		res := h.addItem(sess, sess.phoneHeaders(), d)
		if res.status != http.StatusCreated {
			expectCode(t, res, http.StatusUnprocessableEntity, "session_full")
			break
		}
		added++
	}
	if added == 0 || added >= linkdrop.DefaultMaxItemsPerSession {
		t.Fatalf("added %d maximum-size items before the byte limit", added)
	}
	expectStatus(t, h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/clear", sess.screenHeaders(), nil), http.StatusNoContent)
	expectStatus(t, h.addItem(sess, sess.phoneHeaders(), encryptedDraft()), http.StatusCreated)
}

func TestRealtimeKeepsTheNewestConnectionsPerEndpoint(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	var sockets []*socket
	for range 5 {
		s := h.mustDial(sessionQuery(sess), sess.phone.EndpointKey)
		s.next()
		sockets = append(sockets, s)
	}
	sockets[0].expectClosed()
	h.addItem(sess, sess.screenHeaders(), encryptedDraft())
	for _, s := range sockets[1:] {
		if m := s.next(); m.Type != "session" || len(m.Items) != 1 {
			t.Fatalf("after add = %s", m.raw)
		}
	}
}
