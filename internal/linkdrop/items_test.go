package linkdrop_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/ThiagoSctG/LinkDrop/internal/linkdrop"
)

type item struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Type      string `json:"type"`
	CreatedAt string `json:"createdAt"`
}

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

func TestBothEndpointsShareNewestFirstItems(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()

	link := h.addItem(sess, sess.phoneHeaders(), map[string]string{"title": "  Reunião  ", "content": "https://example.com/a"})
	expectStatus(t, link, http.StatusCreated)
	created := decode[item](t, link)
	if created.Type != "link" || created.Title != "Reunião" || created.ID == "" || created.CreatedAt != "2026-07-09T10:00:00Z" {
		t.Fatalf("created = %+v", created)
	}
	expectStatus(t, h.addItem(sess, sess.screenHeaders(), map[string]string{"content": "line one\nline two", "title": "   "}), http.StatusCreated)

	phoneView := h.state(sess, sess.phoneHeaders())
	screenView := h.state(sess, sess.screenHeaders())
	if phoneView.Role != "phone" || screenView.Role != "screen" || phoneView.ID != sess.phone.SessionID {
		t.Fatalf("roles = %q, %q", phoneView.Role, screenView.Role)
	}
	want := []item{
		{Content: "line one\nline two", Type: "text"},
		{Content: "https://example.com/a", Type: "link", Title: "Reunião"},
	}
	for i, view := range [][]item{phoneView.Items, screenView.Items} {
		if len(view) != 2 {
			t.Fatalf("view %d items = %+v", i, view)
		}
		for j := range want {
			if view[j].Content != want[j].Content || view[j].Type != want[j].Type || view[j].Title != want[j].Title {
				t.Fatalf("view %d item %d = %+v, want %+v", i, j, view[j], want[j])
			}
		}
	}
}

func TestContentClassification(t *testing.T) {
	cases := []struct {
		content string
		kind    string
	}{
		{"https://example.com", "link"},
		{"HTTP://EXAMPLE.COM/a?b=c#d", "link"},
		{"  https://example.com/padded  ", "link"},
		{"Senha: 123", "text"},
		{"Obs: levar documento", "text"},
		{"TODO: revisar", "text"},
		{"localhost:3000", "text"},
		{"192.168.0.1:8080", "text"},
		{"javascript:alert(1)", "text"},
		{"data:text/html,<script>alert(1)</script>", "text"},
		{"<b>html</b>", "text"},
		{"https://example.com and some words", "text"},
		{"https://", "text"},
	}
	h := newHarness(t)
	sess := h.createSession()
	for _, tc := range cases {
		res := h.addItem(sess, sess.phoneHeaders(), map[string]string{"content": tc.content})
		expectStatus(t, res, http.StatusCreated)
		if got := decode[item](t, res).Type; got != tc.kind {
			t.Errorf("%q classified as %q, want %q", tc.content, got, tc.kind)
		}
	}
}

func TestLinksAreStoredWithoutSurroundingSpace(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	res := h.addItem(sess, sess.phoneHeaders(), map[string]string{"content": "\n https://example.com/x \n"})
	if got := decode[item](t, res).Content; got != "https://example.com/x" {
		t.Fatalf("content = %q", got)
	}
}

func TestInvalidContentIsRejected(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	cases := []struct {
		body any
		code string
	}{
		{map[string]any{"content": ""}, "content_empty"},
		{map[string]any{"content": " \n\t "}, "content_empty"},
		{map[string]any{"content": strings.Repeat("x", 10_001)}, "content_too_long"},
		{map[string]any{"content": "ok", "title": strings.Repeat("t", 201)}, "title_too_long"},
		{map[string]any{"content": 42}, "invalid_request"},
		{map[string]any{"content": "ok", "title": 42}, "invalid_request"},
		{"not json", "invalid_request"},
	}
	for _, tc := range cases {
		expectCode(t, h.addItem(sess, sess.phoneHeaders(), tc.body), http.StatusUnprocessableEntity, tc.code)
	}
}

func TestLengthLimitsCountCharactersNotBytes(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	expectStatus(t, h.addItem(sess, sess.phoneHeaders(), map[string]string{
		"content": strings.Repeat("ç", 10_000),
		"title":   strings.Repeat("é", 200),
	}), http.StatusCreated)
}

func TestSessionHasAnItemLimit(t *testing.T) {
	h := newHarness(t, func(c *linkdrop.Config) { c.MaxItemsPerSession = 2 })
	sess := h.createSession()
	expectStatus(t, h.addItem(sess, sess.phoneHeaders(), map[string]string{"content": "1"}), http.StatusCreated)
	expectStatus(t, h.addItem(sess, sess.phoneHeaders(), map[string]string{"content": "2"}), http.StatusCreated)
	expectCode(t, h.addItem(sess, sess.phoneHeaders(), map[string]string{"content": "3"}), http.StatusUnprocessableEntity, "session_full")
}

func TestEitherEndpointRemovesItems(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	first := decode[item](t, h.addItem(sess, sess.phoneHeaders(), map[string]string{"content": "first"}))
	second := decode[item](t, h.addItem(sess, sess.phoneHeaders(), map[string]string{"content": "second"}))
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
	h.addItem(sess, sess.phoneHeaders(), map[string]string{"content": "keep?"})
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
	expectCode(t, h.addItem(sess, map[string]string{"x-endpoint-key": "guess"}, map[string]string{"content": "x"}), http.StatusForbidden, "forbidden")
	expectCode(t, h.do("GET", "/api/sessions/unknown", sess.phoneHeaders(), nil), http.StatusNotFound, "not_found")
}

func TestEndingRemovesTheSessionForBothEndpoints(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	h.addItem(sess, sess.phoneHeaders(), map[string]string{"content": "secret"})
	expectStatus(t, h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/end", sess.phoneHeaders(), nil), http.StatusNoContent)
	expectCode(t, h.do("GET", "/api/sessions/"+sess.phone.SessionID, sess.phoneHeaders(), nil), http.StatusNotFound, "not_found")
	expectCode(t, h.do("GET", "/api/sessions/"+sess.phone.SessionID, sess.screenHeaders(), nil), http.StatusNotFound, "not_found")
	expectCode(t, h.do("GET", "/api/pair/"+sess.screen.Token, sess.screenHeaders(), nil), http.StatusGone, "qr_expired")
}

func TestUnknownAPIRoute(t *testing.T) {
	h := newHarness(t)
	expectCode(t, h.do("GET", "/api/nope", nil, nil), http.StatusNotFound, "not_found")
}
