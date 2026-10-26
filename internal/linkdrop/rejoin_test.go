package linkdrop_test

import (
	"net/http"
	"net/url"
	"sync"
	"testing"
	"time"
)

func TestRejoinScreenIssuesTokenAndPhoneForbidden(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()

	path := "/api/sessions/" + sess.phone.SessionID + "/pairing"
	res := h.do("POST", path, sess.screenHeaders(), nil)
	expectStatus(t, res, http.StatusCreated)
	rejoin := decode[screen](t, res)
	if len(rejoin.Token) < 32 || rejoin.ScreenKey != sess.screen.ScreenKey {
		t.Fatalf("unexpected rejoin token: %+v", rejoin)
	}
	if rejoin.PairingURL != h.server.URL+"/pair/"+rejoin.Token {
		t.Fatalf("pairingUrl = %q", rejoin.PairingURL)
	}

	phoneRes := h.do("POST", path, sess.phoneHeaders(), nil)
	expectCode(t, phoneRes, http.StatusForbidden, "screen_only")

	unknownRes := h.do("POST", "/api/sessions/unknown/pairing", sess.screenHeaders(), nil)
	expectCode(t, unknownRes, http.StatusNotFound, "not_found")
}

func TestRejoinExpiredSessionNotFound(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()

	h.clock.Advance(30 * time.Minute)
	res := h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/pairing", sess.screenHeaders(), nil)
	expectCode(t, res, http.StatusNotFound, "not_found")
}

func TestRejoinPreservesItemsAndReplacesPhone(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()

	itemRes := h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/items", sess.phoneHeaders(), encryptedDraft())
	expectStatus(t, itemRes, http.StatusCreated)

	rejoinRes := h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/pairing", sess.screenHeaders(), nil)
	expectStatus(t, rejoinRes, http.StatusCreated)
	rejoin := decode[screen](t, rejoinRes)

	pairRes := h.do("POST", "/api/pair/"+rejoin.Token, nil, nil)
	expectStatus(t, pairRes, http.StatusCreated)
	newPhone := decode[pairing](t, pairRes)
	if newPhone.SessionID != sess.phone.SessionID {
		t.Fatalf("sessionId = %q, want %q", newPhone.SessionID, sess.phone.SessionID)
	}
	if newPhone.EndpointKey == sess.phone.EndpointKey {
		t.Fatalf("expected new endpoint key")
	}

	viewRes := h.do("GET", "/api/sessions/"+sess.phone.SessionID, map[string]string{"x-endpoint-key": newPhone.EndpointKey}, nil)
	expectStatus(t, viewRes, http.StatusOK)
	view := viewRes.json(t)
	items, ok := view["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("expected 1 item, got %+v", items)
	}

	oldPhoneRes := h.do("GET", "/api/sessions/"+sess.phone.SessionID, sess.phoneHeaders(), nil)
	expectCode(t, oldPhoneRes, http.StatusForbidden, "forbidden")
}

func TestRejoinNotifiesOldPhoneReplacedAndScreenSnapshot(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()

	screenSocket := h.mustDial(url.Values{"sessionId": {sess.phone.SessionID}}, sess.screen.ScreenKey)
	_ = screenSocket.next() // initial

	phoneSocket := h.mustDial(url.Values{"sessionId": {sess.phone.SessionID}}, sess.phone.EndpointKey)
	_ = phoneSocket.next() // initial

	rejoinRes := h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/pairing", sess.screenHeaders(), nil)
	rejoin := decode[screen](t, rejoinRes)
	_ = screenSocket.next() // activity from issuing token
	_ = phoneSocket.next()  // activity from issuing token

	pairRes := h.do("POST", "/api/pair/"+rejoin.Token, nil, nil)
	expectStatus(t, pairRes, http.StatusCreated)

	ended := phoneSocket.next()
	if ended.Type != "session_ended" || ended.Reason != "replaced" {
		t.Fatalf("expected session_ended replaced, got %+v", ended)
	}

	snap := screenSocket.next()
	if snap.ID != sess.phone.SessionID {
		t.Fatalf("snapshot = %+v", snap)
	}
}

func TestRejoinScreenSubscribedToPairingReceivesPaired(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()

	rejoinRes := h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/pairing", sess.screenHeaders(), nil)
	rejoin := decode[screen](t, rejoinRes)

	screenSocket := h.mustDial(url.Values{"pairingToken": {rejoin.Token}}, rejoin.ScreenKey)

	pairRes := h.do("POST", "/api/pair/"+rejoin.Token, nil, nil)
	expectStatus(t, pairRes, http.StatusCreated)

	msg := screenSocket.next()
	if msg.Type != "paired" || msg.SessionID != sess.phone.SessionID {
		t.Fatalf("unexpected message: %+v", msg)
	}
}

func TestRejoinSecondTokenExpiresFirst(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()

	firstRes := h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/pairing", sess.screenHeaders(), nil)
	first := decode[screen](t, firstRes)

	socket := h.mustDial(url.Values{"pairingToken": {first.Token}}, first.ScreenKey)

	secondRes := h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/pairing", sess.screenHeaders(), nil)
	expectStatus(t, secondRes, http.StatusCreated)

	expired := socket.next()
	if expired.Type != "pairing_expired" {
		t.Fatalf("expected pairing_expired, got %+v", expired)
	}

	pairFirst := h.do("POST", "/api/pair/"+first.Token, nil, nil)
	expectCode(t, pairFirst, http.StatusGone, "qr_expired")
}

func TestRejoinUnscannedTokenExpires(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()

	rejoinRes := h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/pairing", sess.screenHeaders(), nil)
	rejoin := decode[screen](t, rejoinRes)

	h.clock.Advance(2*time.Minute + time.Second)
	res := h.do("POST", "/api/pair/"+rejoin.Token, nil, nil)
	expectCode(t, res, http.StatusGone, "qr_expired")
}

func TestRejoinEndSessionInvalidatesToken(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()

	rejoinRes := h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/pairing", sess.screenHeaders(), nil)
	rejoin := decode[screen](t, rejoinRes)

	endRes := h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/end", sess.screenHeaders(), nil)
	expectStatus(t, endRes, http.StatusNoContent)

	pairRes := h.do("POST", "/api/pair/"+rejoin.Token, nil, nil)
	expectCode(t, pairRes, http.StatusGone, "qr_expired")
}

func TestRejoinSessionExpiryInvalidatesToken(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()

	rejoin := decode[screen](t, h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/pairing", sess.screenHeaders(), nil))
	expectStatus(t, h.do("POST", "/api/pair/"+rejoin.Token, nil, nil), http.StatusCreated)

	h.clock.Advance(30 * time.Minute)
	expectCode(t, h.do("GET", "/api/sessions/"+sess.phone.SessionID, sess.screenHeaders(), nil), http.StatusNotFound, "not_found")
	expectCode(t, h.do("GET", "/api/pair/"+rejoin.Token, sess.screenHeaders(), nil), http.StatusGone, "qr_expired")
}

func TestRejoinNewTokenRemovesScannedOne(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	path := "/api/sessions/" + sess.phone.SessionID + "/pairing"

	first := decode[screen](t, h.do("POST", path, sess.screenHeaders(), nil))
	expectStatus(t, h.do("POST", "/api/pair/"+first.Token, nil, nil), http.StatusCreated)
	expectStatus(t, h.do("GET", "/api/pair/"+first.Token, sess.screenHeaders(), nil), http.StatusOK)

	second := decode[screen](t, h.do("POST", path, sess.screenHeaders(), nil))
	expectCode(t, h.do("GET", "/api/pair/"+first.Token, sess.screenHeaders(), nil), http.StatusGone, "qr_expired")

	expectStatus(t, h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/end", sess.screenHeaders(), nil), http.StatusNoContent)
	expectCode(t, h.do("GET", "/api/pair/"+second.Token, sess.screenHeaders(), nil), http.StatusGone, "qr_expired")
}

func TestRejoinConcurrentScansPairExactlyOne(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()

	rejoinRes := h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/pairing", sess.screenHeaders(), nil)
	rejoin := decode[screen](t, rejoinRes)

	statuses := make([]int, 8)
	var wg sync.WaitGroup
	for i := range statuses {
		wg.Add(1)
		go func() {
			defer wg.Done()
			statuses[i] = h.do("POST", "/api/pair/"+rejoin.Token, nil, nil).status
		}()
	}
	wg.Wait()
	created, conflicts := 0, 0
	for _, status := range statuses {
		switch status {
		case http.StatusCreated:
			created++
		case http.StatusConflict:
			conflicts++
		}
	}
	if created != 1 || conflicts != len(statuses)-1 {
		t.Fatalf("statuses = %v", statuses)
	}
}

func TestRejoinIssuingTokenIsActivity(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()

	h.clock.Advance(10 * time.Minute)
	before := h.do("GET", "/api/sessions/"+sess.phone.SessionID, sess.screenHeaders(), nil).json(t)["expiresInMs"].(float64)

	_ = h.do("POST", "/api/sessions/"+sess.phone.SessionID+"/pairing", sess.screenHeaders(), nil)

	after := h.do("GET", "/api/sessions/"+sess.phone.SessionID, sess.screenHeaders(), nil).json(t)["expiresInMs"].(float64)
	if after <= before {
		t.Fatalf("expected activity renewal: before %v, after %v", before, after)
	}
}
