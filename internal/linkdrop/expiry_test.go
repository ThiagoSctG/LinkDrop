package linkdrop_test

import (
	"net/http"
	"testing"
	"time"
)

func TestSessionExpiresAfterInactivity(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	h.clock.Advance(29 * time.Minute)
	h.state(sess, sess.phoneHeaders()) // reading is not activity
	h.clock.Advance(time.Minute)
	expectCode(t, h.do("GET", "/api/sessions/"+sess.phone.SessionID, sess.screenHeaders(), nil), http.StatusNotFound, "not_found")
}

func TestExplicitActionsRenewActivity(t *testing.T) {
	actions := map[string]func(h *harness, sess session){
		"activity": func(h *harness, sess session) {
			expectStatus(t, h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/activity", sess.phoneHeaders(), nil), http.StatusNoContent)
		},
		"add": func(h *harness, sess session) {
			expectStatus(t, h.addItem(sess, sess.phoneHeaders(), map[string]string{"content": "x"}), http.StatusCreated)
		},
		"remove": func(h *harness, sess session) {
			expectStatus(t, h.do("DELETE", "/api/sessions/"+sess.phone.SessionID+"/items/missing", sess.phoneHeaders(), nil), http.StatusNoContent)
		},
		"clear": func(h *harness, sess session) {
			expectStatus(t, h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/clear", sess.screenHeaders(), nil), http.StatusNoContent)
		},
	}
	for name, act := range actions {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			sess := h.createSession()
			h.clock.Advance(29 * time.Minute)
			act(h, sess)
			h.clock.Advance(29 * time.Minute)
			h.state(sess, sess.phoneHeaders())
			h.clock.Advance(time.Minute)
			expectCode(t, h.do("GET", "/api/sessions/"+sess.phone.SessionID, sess.phoneHeaders(), nil), http.StatusNotFound, "not_found")
		})
	}
}

func TestExpiredSessionRejectsMutations(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	h.clock.Advance(30 * time.Minute)
	expectCode(t, h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/activity", sess.phoneHeaders(), nil), http.StatusNotFound, "not_found")
	expectCode(t, h.addItem(sess, sess.phoneHeaders(), map[string]string{"content": "x"}), http.StatusNotFound, "not_found")
}
