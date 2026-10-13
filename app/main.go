package main

import (
	"embed"
	"net/http"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "Diagram Vault",
		Width:     1200,
		Height:    820,
		MinWidth:  760,
		MinHeight: 520,
		AssetServer: &assetserver.Options{
			Assets: assets,
			// Diagram files live in the library folder, not the bundle. They're
			// served at /vault/<library-relative path>. Middleware (not Handler)
			// so it also wins over the Vite dev server in `wails dev`.
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					rel, ok := strings.CutPrefix(r.URL.Path, "/vault/")
					if !ok {
						next.ServeHTTP(w, r)
						return
					}
					p, err := app.abs(rel)
					if err != nil {
						http.Error(w, err.Error(), http.StatusForbidden)
						return
					}
					w.Header().Set("Cache-Control", "no-cache")
					http.ServeFile(w, r, p)
				})
			},
		},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		OnStartup: app.startup,
		Bind:      []interface{}{app},
		Mac: &mac.Options{
			About: &mac.AboutInfo{
				Title:   "Diagram Vault",
				Message: "Diagrams and notes, stored as plain files.",
			},
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
