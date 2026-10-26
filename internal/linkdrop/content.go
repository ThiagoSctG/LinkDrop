package linkdrop

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"regexp"
	"time"
)

// EncryptedContent is opaque to the server. Keys and plaintext stay on devices.
type EncryptedContent struct {
	Version int    `json:"v"`
	IV      string `json:"iv"`
	Data    string `json:"data"`
}

type Item struct {
	ID        string           `json:"id"`
	Encrypted EncryptedContent `json:"encrypted"`
	CreatedAt time.Time        `json:"createdAt"`
}

type draft struct {
	ID        string           `json:"id"`
	Encrypted EncryptedContent `json:"encrypted"`
}

const maxCiphertextBytes = 65_536

var itemIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// Only versioned ciphertext envelopes are accepted. Legacy plaintext is rejected.
// Content/title length and URL classification are enforced on the devices.
func parseDraft(body []byte) (draft, *apiError) {
	var input draft
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || !itemIDPattern.MatchString(input.ID) || input.Encrypted.Version != 1 {
		return draft{}, errInvalidRequest
	}
	e := input.Encrypted
	if len(e.IV) != 16 || len(e.Data) < 22 || len(e.Data) > base64.RawURLEncoding.EncodedLen(maxCiphertextBytes) {
		return draft{}, errInvalidRequest
	}
	iv, err := base64.RawURLEncoding.Strict().DecodeString(e.IV)
	if err != nil || len(iv) != 12 || base64.RawURLEncoding.EncodeToString(iv) != e.IV {
		return draft{}, errInvalidRequest
	}
	ciphertext, err := base64.RawURLEncoding.Strict().DecodeString(e.Data)
	if err != nil || len(ciphertext) < 16 || len(ciphertext) > maxCiphertextBytes || base64.RawURLEncoding.EncodeToString(ciphertext) != e.Data {
		return draft{}, errInvalidRequest
	}
	return input, nil
}
