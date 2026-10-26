package linkdrop_test

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/ThiagoSctG/LinkDrop/internal/linkdrop"
)

type item = linkdrop.Item

type sessionState struct {
	ID    string `json:"id"`
	Role  string `json:"role"`
	Items []item `json:"items"`
}

func (h *harness) addItem(sess session, headers map[string]string, body any) response {
	h.t.Helper()
	return h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/items", headers, body)
}

func (h *harness) state(sess session, headers map[string]string) sessionState {
	h.t.Helper()
	res := h.do("GET", "/api/sessions/"+sess.phone.SessionID, headers, nil)
	expectStatus(h.t, res, http.StatusOK)
	return decode[sessionState](h.t, res)
}

var nextItemID uint64

// Opaque structural fixtures, not a plaintext compatibility mode.
func encryptedDraft() map[string]any {
	nextItemID++
	return map[string]any{"id": fmt.Sprintf("00000000-0000-4000-8000-%012x", nextItemID), "encrypted": map[string]any{"v": 1, "iv": base64.RawURLEncoding.EncodeToString(make([]byte, 12)), "data": base64.RawURLEncoding.EncodeToString(make([]byte, 32))}}
}

func TestBothEndpointsShareOpaqueNewestFirstItems(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	firstRes := h.addItem(sess, sess.phoneHeaders(), encryptedDraft())
	expectStatus(t, firstRes, http.StatusCreated)
	first := decode[item](t, firstRes)
	secondRes := h.addItem(sess, sess.screenHeaders(), encryptedDraft())
	expectStatus(t, secondRes, http.StatusCreated)
	second := decode[item](t, secondRes)
	for _, headers := range []map[string]string{sess.phoneHeaders(), sess.screenHeaders()} {
		view := h.state(sess, headers)
		if len(view.Items) != 2 || view.Items[0] != second || view.Items[1] != first {
			t.Fatalf("unexpected items: %+v", view.Items)
		}
	}
	if first.CreatedAt.Format("2006-01-02T15:04:05Z") != "2026-07-09T10:00:00Z" {
		t.Fatal(first.CreatedAt)
	}
	res := h.do("GET", "/api/sessions/"+sess.phone.SessionID, sess.phoneHeaders(), nil)
	for _, field := range []string{`"content":`, `"title":`, `"type":`} {
		if strings.Contains(string(res.body), field) {
			t.Fatalf("plaintext field %s", field)
		}
	}
}

func TestPlaintextAndMalformedEnvelopesRejected(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	cases := []any{map[string]string{"content": "secret", "title": "private"}, "not json", nil}
	for _, field := range []string{"iv", "data", "v"} {
		d := encryptedDraft()
		d["encrypted"].(map[string]any)[field] = "invalid!"
		cases = append(cases, d)
	}
	for _, id := range []string{"", "not-a-uuid"} {
		d := encryptedDraft()
		d["id"] = id
		cases = append(cases, d)
	}
	d := encryptedDraft()
	d["content"] = "secret"
	cases = append(cases, d)
	d = encryptedDraft()
	d["encrypted"].(map[string]any)["content"] = "secret"
	cases = append(cases, d)
	d = encryptedDraft()
	d["encrypted"].(map[string]any)["v"] = 2
	cases = append(cases, d)
	d = encryptedDraft()
	d["encrypted"].(map[string]any)["data"] = base64.RawURLEncoding.EncodeToString(make([]byte, 65_537))
	cases = append(cases, d)
	for _, body := range cases {
		expectCode(t, h.addItem(sess, sess.phoneHeaders(), body), http.StatusUnprocessableEntity, "invalid_request")
	}
	if len(h.state(sess, sess.phoneHeaders()).Items) != 0 {
		t.Fatal("invalid envelope stored")
	}
}

func TestDuplicateItemIDRejected(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	d := encryptedDraft()
	expectStatus(t, h.addItem(sess, sess.phoneHeaders(), d), http.StatusCreated)
	expectCode(t, h.addItem(sess, sess.phoneHeaders(), d), http.StatusUnprocessableEntity, "invalid_request")
}

func TestCiphertextSizeBoundary(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	d := encryptedDraft()
	d["encrypted"].(map[string]any)["data"] = base64.RawURLEncoding.EncodeToString(make([]byte, 65_536))
	expectStatus(t, h.addItem(sess, sess.phoneHeaders(), d), http.StatusCreated)
}

func TestSessionHasAnItemLimit(t *testing.T) {
	h := newHarness(t, func(c *linkdrop.Config) { c.MaxItemsPerSession = 2 })
	sess := h.createSession()
	expectStatus(t, h.addItem(sess, sess.phoneHeaders(), encryptedDraft()), http.StatusCreated)
	expectStatus(t, h.addItem(sess, sess.phoneHeaders(), encryptedDraft()), http.StatusCreated)
	expectCode(t, h.addItem(sess, sess.phoneHeaders(), encryptedDraft()), http.StatusUnprocessableEntity, "session_full")
}

func TestEitherEndpointRemovesItems(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	first := decode[item](t, h.addItem(sess, sess.phoneHeaders(), encryptedDraft()))
	second := decode[item](t, h.addItem(sess, sess.phoneHeaders(), encryptedDraft()))
	base := "/api/sessions/" + sess.phone.SessionID + "/items/"
	expectStatus(t, h.do("DELETE", base+first.ID, sess.screenHeaders(), nil), http.StatusNoContent)
	expectStatus(t, h.do("DELETE", base+second.ID, sess.phoneHeaders(), nil), http.StatusNoContent)
	if items := h.state(sess, sess.phoneHeaders()).Items; len(items) != 0 {
		t.Fatalf("items = %+v", items)
	}
}

func TestOnlyTheScreenClearsTheList(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	h.addItem(sess, sess.phoneHeaders(), encryptedDraft())
	clear := "/api/sessions/" + sess.phone.SessionID + "/clear"
	expectCode(t, h.do("POST", clear, sess.phoneHeaders(), nil), http.StatusForbidden, "screen_only")
	if len(h.state(sess, sess.phoneHeaders()).Items) != 1 {
		t.Fatal("phone cleared the list")
	}
	expectStatus(t, h.do("POST", clear, sess.screenHeaders(), nil), http.StatusNoContent)
	if len(h.state(sess, sess.phoneHeaders()).Items) != 0 {
		t.Fatal("screen did not clear the list")
	}
}

func TestSessionRequiresAPairedEndpointKey(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	path := "/api/sessions/" + sess.phone.SessionID
	expectCode(t, h.do("GET", path, nil, nil), http.StatusForbidden, "forbidden")
	expectCode(t, h.do("GET", path, map[string]string{"x-endpoint-key": "guess"}, nil), http.StatusForbidden, "forbidden")
	expectCode(t, h.addItem(sess, map[string]string{"x-endpoint-key": "guess"}, encryptedDraft()), http.StatusForbidden, "forbidden")
	expectCode(t, h.do("GET", "/api/sessions/unknown", sess.phoneHeaders(), nil), http.StatusNotFound, "not_found")
}

func TestEndingRemovesTheSessionForBothEndpoints(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	h.addItem(sess, sess.phoneHeaders(), encryptedDraft())
	expectStatus(t, h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/end", sess.phoneHeaders(), nil), http.StatusNoContent)
	expectCode(t, h.do("GET", "/api/sessions/"+sess.phone.SessionID, sess.phoneHeaders(), nil), http.StatusNotFound, "not_found")
	expectCode(t, h.do("GET", "/api/sessions/"+sess.phone.SessionID, sess.screenHeaders(), nil), http.StatusNotFound, "not_found")
	expectCode(t, h.do("GET", "/api/pair/"+sess.screen.Token, sess.screenHeaders(), nil), http.StatusGone, "qr_expired")
}

func TestUnknownAPIRoute(t *testing.T) {
	h := newHarness(t)
	expectCode(t, h.do("GET", "/api/nope", nil, nil), http.StatusNotFound, "not_found")
}
