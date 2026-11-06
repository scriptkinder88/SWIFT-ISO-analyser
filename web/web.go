// Package web embeds the static interface so the binary has no runtime files.
package web

import (
	"embed"
	"io/fs"
)

//go:embed index.html app.js symbols.js style.css
var files embed.FS

// Files returns the static files rooted at the web directory.
func Files() fs.FS { return files }
