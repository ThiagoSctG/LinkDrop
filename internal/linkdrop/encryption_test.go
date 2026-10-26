package linkdrop_test

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestEncryptedItemTravelsThroughHTTPAndRealtimeWithoutPlaintext(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	phone := h.mustDial(sessionQuery(sess), sess.phone.EndpointKey)
	phone.next() // initial empty snapshot
	key := make([]byte, 32)
	rand.Read(key)
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	nonce := make([]byte, 12)
	rand.Read(nonce)
	draft := encryptedDraft()
	id := draft["id"].(string)
	aad, err := json.Marshal([]string{"linkdrop.item.v1", sess.phone.SessionID, id})
	if err != nil {
		t.Fatal(err)
	}
	plaintext := []byte(`{"title":"Private title","content":"Private note"}`)
	encrypted := draft["encrypted"].(map[string]any)
	encrypted["iv"] = base64.RawURLEncoding.EncodeToString(nonce)
	encrypted["data"] = base64.RawURLEncoding.EncodeToString(gcm.Seal(nil, nonce, plaintext, aad))
	created := h.addItem(sess, sess.screenHeaders(), draft)
	expectStatus(t, created, http.StatusCreated)
	snapshot := phone.next()
	if len(snapshot.Items) != 1 || snapshot.Items[0].ID != id {
		t.Fatalf("snapshot: %+v", snapshot)
	}
	view := h.do("GET", "/api/sessions/"+sess.phone.SessionID, sess.phoneHeaders(), nil)
	expectStatus(t, view, http.StatusOK)
	for _, raw := range []string{string(created.body), string(view.body), snapshot.raw} {
		if strings.Contains(raw, "Private") || strings.Contains(raw, base64.RawURLEncoding.EncodeToString(key)) {
			t.Fatal("plaintext or encryption key in response")
		}
	}
	stored := snapshot.Items[0].Encrypted
	ciphertext, err := base64.RawURLEncoding.DecodeString(stored.Data)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := gcm.Open(nil, nonce, ciphertext, aad)
	if err != nil {
		t.Fatal(err)
	}
	if string(decoded) != string(plaintext) {
		t.Fatal("ciphertext changed in transit")
	}
}
