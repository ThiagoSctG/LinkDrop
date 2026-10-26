package linkdrop_test

import (
	"net/http"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/ThiagoSctG/LinkDrop/internal/linkdrop"
)

var builtFrontend = fstest.MapFS{
	"index.html":           {Data: []byte("<!doctype html><title>LinkDrop</title>")},
	"theme.js":             {Data: []byte("/* theme */")},
	"assets/app-1a2b3c.js": {Data: []byte("console.log(1)")},
}

func withFrontend(c *linkdrop.Config) { c.Assets = builtFrontend }

func TestAppRoutesServeTheSinglePageApp(t *testing.T) {
	h := newHarness(t, withFrontend)
	for _, path := range []string{"/", "/pair", "/pair/some-token"} {
		res := h.do("GET", path, nil, nil)
		expectStatus(t, res, http.StatusOK)
		if !strings.Contains(string(res.body), "<title>LinkDrop</title>") {
			t.Fatalf("%s body = %q", path, res.body)
		}
		if got := res.header.Get("cache-control"); got != "no-cache" {
			t.Fatalf("%s cache-control = %q", path, got)
		}
		if got := res.header.Get("content-type"); !strings.HasPrefix(got, "text/html") {
			t.Fatalf("%s content-type = %q", path, got)
		}
	}
}

func TestHashedAssetsAreCachedForever(t *testing.T) {
	h := newHarness(t, withFrontend)
	res := h.do("GET", "/assets/app-1a2b3c.js", nil, nil)
	expectStatus(t, res, http.StatusOK)
	if string(res.body) != "console.log(1)" || !strings.Contains(res.header.Get("cache-control"), "immutable") {
		t.Fatalf("asset = %q, cache-control %q", res.body, res.header.Get("cache-control"))
	}
	root := h.do("GET", "/theme.js", nil, nil)
	expectStatus(t, root, http.StatusOK)
	if strings.Contains(root.header.Get("cache-control"), "immutable") {
		t.Fatal("unhashed file cached forever")
	}
}

func TestUnknownFilesAreNotFound(t *testing.T) {
	h := newHarness(t, withFrontend)
	for _, path := range []string{"/missing.js", "/assets/nope.js", "/pair/a/b", "/../go.mod"} {
		expectStatus(t, h.do("GET", path, nil, nil), http.StatusNotFound)
	}
}

func TestStaticFilesDoNotSpendTheRateLimit(t *testing.T) {
	h := newHarness(t, withFrontend)
	for range 70 {
		expectStatus(t, h.do("GET", "/", nil, nil), http.StatusOK)
	}
	expectStatus(t, h.do("GET", "/api/health", nil, nil), http.StatusOK)
}

func TestMissingFrontendBuildIsExplained(t *testing.T) {
	h := newHarness(t)
	res := h.do("GET", "/", nil, nil)
	expectStatus(t, res, http.StatusServiceUnavailable)
	if !strings.Contains(string(res.body), "npm run build") {
		t.Fatalf("body = %q", res.body)
	}
}
