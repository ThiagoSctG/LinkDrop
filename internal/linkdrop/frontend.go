package linkdrop

import (
	"bytes"
	"io/fs"
	"net/http"
	"strings"
	"time"
)

const missingFrontend = "LinkDrop frontend is not built. Run `npm ci && npm run build` and restart.\n"

// frontend serves the built single-page app. App routes get index.html; files under
// assets/ carry a content hash in their name and can be cached forever.
func (s *Server) frontend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("allow", "GET, HEAD")
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}
	if s.cfg.Assets == nil {
		w.Header().Set("content-type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(missingFrontend))
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/")
	cache := "no-cache"
	switch {
	case isAppRoute(name):
		name = "index.html"
	case strings.HasPrefix(name, "assets/"):
		cache = "public, max-age=31536000, immutable"
	}
	data, err := fs.ReadFile(s.cfg.Assets, name)
	if err != nil || !fs.ValidPath(name) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("cache-control", cache)
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}

func isAppRoute(name string) bool {
	if name == "" || name == "pair" {
		return true
	}
	token, ok := strings.CutPrefix(name, "pair/")
	return ok && token != "" && !strings.Contains(token, "/")
}
