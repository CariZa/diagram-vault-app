package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const docFile = "doc.json"

// App is bound to the frontend. All paths crossing the boundary are
// relative to the library root, using forward slashes.
type App struct {
	ctx  context.Context
	root string
}

type Diagram struct {
	ID      string `json:"id"`
	File    string `json:"file"` // relative to the doc folder, e.g. assets/x.png
	Kind    string `json:"kind"` // "image" | "mermaid"
	Caption string `json:"caption"`
}

type Note struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Markdown  string `json:"markdown"`
	HTML      string `json:"html,omitempty"` // legacy; converted to Markdown on load
	Collapsed bool   `json:"collapsed"`
	Updated   int64  `json:"updated"`
}

type Doc struct {
	Version  int       `json:"version"`
	Title    string    `json:"title"`
	Diagrams []Diagram `json:"diagrams"`
	Notes    []Note    `json:"notes"`
}

type Node struct {
	Name     string  `json:"name"`
	Path     string  `json:"path"`
	Kind     string  `json:"kind"` // "folder" | "doc"
	Children []*Node `json:"children,omitempty"`
}

func NewApp() *App {
	// DIAGRAM_VAULT_DIR overrides the library location (handy for testing).
	if dir := os.Getenv("DIAGRAM_VAULT_DIR"); dir != "" {
		return &App{root: filepath.Clean(dir)}
	}
	home, _ := os.UserHomeDir()
	return &App{root: filepath.Join(home, "Documents", "Diagram Vault")}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	_ = os.MkdirAll(a.root, 0o755)
}

// abs resolves a library-relative path and refuses anything escaping the root.
func (a *App) abs(rel string) (string, error) {
	p := filepath.Join(a.root, filepath.FromSlash(rel))
	if p != a.root && !strings.HasPrefix(p, a.root+string(filepath.Separator)) {
		return "", fmt.Errorf("path outside library: %q", rel)
	}
	return p, nil
}

func (a *App) rel(abs string) string {
	r, _ := filepath.Rel(a.root, abs)
	return filepath.ToSlash(r)
}

func isDoc(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, docFile))
	return err == nil
}

func (a *App) LibraryRoot() string { return a.root }

func (a *App) ListTree() (*Node, error) {
	return a.walk(a.root)
}

func (a *App) walk(dir string) (*Node, error) {
	n := &Node{Name: filepath.Base(dir), Path: a.rel(dir), Kind: "folder"}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		p := filepath.Join(dir, e.Name())
		if isDoc(p) {
			n.Children = append(n.Children, &Node{Name: a.docTitle(p), Path: a.rel(p), Kind: "doc"})
			continue
		}
		child, err := a.walk(p)
		if err != nil {
			return nil, err
		}
		n.Children = append(n.Children, child)
	}
	sort.SliceStable(n.Children, func(i, j int) bool {
		ci, cj := n.Children[i], n.Children[j]
		if ci.Kind != cj.Kind {
			return ci.Kind == "folder"
		}
		return strings.ToLower(ci.Name) < strings.ToLower(cj.Name)
	})
	return n, nil
}

func (a *App) docTitle(dir string) string {
	var d Doc
	if b, err := os.ReadFile(filepath.Join(dir, docFile)); err == nil && json.Unmarshal(b, &d) == nil && d.Title != "" {
		return d.Title
	}
	return filepath.Base(dir)
}

// sanitize turns a user-facing name into a safe folder name.
func sanitize(name string) string {
	name = strings.TrimSpace(name)
	name = strings.NewReplacer("/", "-", ":", "-", "\\", "-").Replace(name)
	name = strings.TrimLeft(name, ".")
	if name == "" {
		name = "Untitled"
	}
	return name
}

// uniquePath returns dir/name, appending " 2", " 3"... if it already exists.
// `except` is allowed to be returned (used when renaming to the same name).
func uniquePath(dir, name, except string) string {
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	p := filepath.Join(dir, name)
	for i := 2; ; i++ {
		if _, err := os.Stat(p); errors.Is(err, os.ErrNotExist) || p == except {
			return p
		}
		p = filepath.Join(dir, fmt.Sprintf("%s %d%s", base, i, ext))
	}
}

func (a *App) CreateFolder(parentRel, name string) (string, error) {
	parent, err := a.abs(parentRel)
	if err != nil {
		return "", err
	}
	p := uniquePath(parent, sanitize(name), "")
	if err := os.MkdirAll(p, 0o755); err != nil {
		return "", err
	}
	return a.rel(p), nil
}

func (a *App) CreateDoc(parentRel, title string) (string, error) {
	parent, err := a.abs(parentRel)
	if err != nil {
		return "", err
	}
	p := uniquePath(parent, sanitize(title), "")
	if err := os.MkdirAll(filepath.Join(p, "assets"), 0o755); err != nil {
		return "", err
	}
	d := Doc{Version: 1, Title: title, Diagrams: []Diagram{}, Notes: []Note{}}
	if err := writeJSON(filepath.Join(p, docFile), d); err != nil {
		return "", err
	}
	return a.rel(p), nil
}

// Rename renames a folder or doc on disk. For docs, the title in doc.json is
// updated too. Returns the new relative path.
func (a *App) Rename(rel, newName string) (string, error) {
	p, err := a.abs(rel)
	if err != nil || p == a.root {
		return "", fmt.Errorf("cannot rename %q", rel)
	}
	np := uniquePath(filepath.Dir(p), sanitize(newName), p)
	if np != p {
		if err := os.Rename(p, np); err != nil {
			return "", err
		}
	}
	if isDoc(np) {
		d, err := readDoc(np)
		if err != nil {
			return "", err
		}
		d.Title = strings.TrimSpace(newName)
		if err := writeJSON(filepath.Join(np, docFile), d); err != nil {
			return "", err
		}
	}
	return a.rel(np), nil
}

func (a *App) Trash(rel string) error {
	p, err := a.abs(rel)
	if err != nil || p == a.root {
		return fmt.Errorf("cannot trash %q", rel)
	}
	return moveToTrash(p)
}

func (a *App) Reveal(rel string) error {
	p, err := a.abs(rel)
	if err != nil {
		return err
	}
	return exec.Command("open", "-R", p).Run()
}

func readDoc(dir string) (Doc, error) {
	var d Doc
	b, err := os.ReadFile(filepath.Join(dir, docFile))
	if err != nil {
		return d, err
	}
	if err := json.Unmarshal(b, &d); err != nil {
		return d, err
	}
	if d.Diagrams == nil {
		d.Diagrams = []Diagram{}
	}
	if d.Notes == nil {
		d.Notes = []Note{}
	}
	return d, nil
}

func (a *App) LoadDoc(rel string) (Doc, error) {
	p, err := a.abs(rel)
	if err != nil {
		return Doc{}, err
	}
	return readDoc(p)
}

func (a *App) SaveDoc(rel string, d Doc) error {
	p, err := a.abs(rel)
	if err != nil {
		return err
	}
	if !isDoc(p) {
		return fmt.Errorf("not a doc: %q", rel)
	}
	d.Version = 1
	return writeJSON(filepath.Join(p, docFile), d)
}

// writeJSON writes atomically: temp file in the same dir, fsync, rename.
func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err := f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}

func newID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

var imageExts = map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".svg": true, ".webp": true}

func kindFor(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch {
	case imageExts[ext]:
		return "image"
	case ext == ".mmd" || ext == ".mermaid":
		return "mermaid"
	}
	return ""
}

// PickDiagramFiles opens the native file picker.
func (a *App) PickDiagramFiles() ([]string, error) {
	return runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Add diagrams",
		Filters: []runtime.FileFilter{{
			DisplayName: "Diagrams (PNG, JPG, SVG, Mermaid)",
			Pattern:     "*.png;*.jpg;*.jpeg;*.gif;*.svg;*.webp;*.mmd;*.mermaid",
		}},
	})
}

// ImportFiles copies external files into the doc's assets folder and returns
// diagram entries for them. Unsupported files are skipped. The caller adds the
// entries to the doc and saves it.
func (a *App) ImportFiles(docRel string, paths []string) ([]Diagram, error) {
	dir, err := a.abs(docRel)
	if err != nil {
		return nil, err
	}
	assets := filepath.Join(dir, "assets")
	if err := os.MkdirAll(assets, 0o755); err != nil {
		return nil, err
	}
	out := []Diagram{}
	for _, src := range paths {
		kind := kindFor(src)
		if kind == "" {
			continue
		}
		dst := uniquePath(assets, filepath.Base(src), "")
		if err := copyFile(src, dst); err != nil {
			return out, err
		}
		name := filepath.Base(src)
		out = append(out, Diagram{
			ID:      newID(),
			File:    "assets/" + filepath.Base(dst),
			Kind:    kind,
			Caption: strings.TrimSuffix(name, filepath.Ext(name)),
		})
	}
	return out, nil
}

func (a *App) AddMermaid(docRel, source, caption string) (Diagram, error) {
	dir, err := a.abs(docRel)
	if err != nil {
		return Diagram{}, err
	}
	assets := filepath.Join(dir, "assets")
	if err := os.MkdirAll(assets, 0o755); err != nil {
		return Diagram{}, err
	}
	name := sanitize(caption)
	if caption == "" {
		name = "diagram"
	}
	dst := uniquePath(assets, name+".mmd", "")
	if err := os.WriteFile(dst, []byte(source), 0o644); err != nil {
		return Diagram{}, err
	}
	return Diagram{ID: newID(), File: "assets/" + filepath.Base(dst), Kind: "mermaid", Caption: caption}, nil
}

// DeleteAsset removes a diagram file from a doc (after it was removed from doc.json).
func (a *App) DeleteAsset(docRel, file string) error {
	p, err := a.abs(docRel + "/" + file)
	if err != nil {
		return err
	}
	return os.Remove(p)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// Confirm shows a native yes/no dialog. The webview has no window.confirm.
func (a *App) Confirm(title, message, okLabel string) (bool, error) {
	res, err := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
		Type:          runtime.QuestionDialog,
		Title:         title,
		Message:       message,
		Buttons:       []string{okLabel, "Cancel"},
		DefaultButton: okLabel,
		CancelButton:  "Cancel",
	})
	return res == okLabel, err
}

func (a *App) OpenURL(url string) {
	runtime.BrowserOpenURL(a.ctx, url)
}
