package linkdrop

import (
	"encoding/json"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

type ItemType string

const (
	ItemLink ItemType = "link"
	ItemNote ItemType = "text"
)

const (
	maxContentChars = 10_000
	maxTitleChars   = 200
)

type Item struct {
	ID        string    `json:"id"`
	Title     string    `json:"title,omitempty"`
	Content   string    `json:"content"`
	Type      ItemType  `json:"type"`
	CreatedAt time.Time `json:"createdAt"`
}

type draft struct {
	title   string
	content string
	kind    ItemType
}

// parseDraft validates a request body. Only http(s) URLs become links; everything
// else, including other schemes like javascript:, is kept as plain text.
func parseDraft(body []byte) (draft, *apiError) {
	var input struct {
		Title   *string `json:"title"`
		Content *string `json:"content"`
	}
	if err := json.Unmarshal(body, &input); err != nil || input.Content == nil {
		return draft{}, errInvalidRequest
	}
	content := *input.Content
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return draft{}, errContentEmpty
	}
	if utf8.RuneCountInString(content) > maxContentChars {
		return draft{}, errContentLong
	}
	var title string
	if input.Title != nil {
		title = strings.TrimSpace(*input.Title)
		if utf8.RuneCountInString(title) > maxTitleChars {
			return draft{}, errTitleLong
		}
	}
	if isLink(trimmed) {
		return draft{title: title, content: trimmed, kind: ItemLink}, nil
	}
	return draft{title: title, content: content, kind: ItemNote}, nil
}

func isLink(s string) bool {
	lower := strings.ToLower(s)
	if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		return false
	}
	if strings.IndexFunc(s, unicode.IsSpace) >= 0 {
		return false
	}
	u, err := url.Parse(s)
	return err == nil && u.Host != ""
}
