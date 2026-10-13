package main

import (
	"os"
	"path/filepath"
	"testing"
)

func testApp(t *testing.T) *App {
	a := &App{root: t.TempDir()}
	return a
}

func TestDocLifecycle(t *testing.T) {
	a := testApp(t)
	folder, err := a.CreateFolder("", "Work")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := a.CreateDoc(folder, "Checkout flow")
	if err != nil {
		t.Fatal(err)
	}
	if doc != "Work/Checkout flow" {
		t.Fatalf("doc path = %q", doc)
	}
	// Same title again gets a unique folder.
	if d2, _ := a.CreateDoc(folder, "Checkout flow"); d2 != "Work/Checkout flow 2" {
		t.Fatalf("second doc path = %q", d2)
	}

	d, err := a.LoadDoc(doc)
	if err != nil {
		t.Fatal(err)
	}
	d.Notes = append(d.Notes, Note{ID: "n1", Name: "Note 1", Markdown: "hi"})
	if err := a.SaveDoc(doc, d); err != nil {
		t.Fatal(err)
	}

	np, err := a.Rename(doc, "Checkout v2")
	if err != nil || np != "Work/Checkout v2" {
		t.Fatalf("rename = %q, %v", np, err)
	}
	d, _ = a.LoadDoc(np)
	if d.Title != "Checkout v2" || len(d.Notes) != 1 {
		t.Fatalf("after rename: %+v", d)
	}
	// Renaming to the same name is a no-op, not "Checkout v2 2".
	if p, _ := a.Rename(np, "Checkout v2"); p != np {
		t.Fatalf("same-name rename moved to %q", p)
	}

	tree, err := a.ListTree()
	if err != nil {
		t.Fatal(err)
	}
	if len(tree.Children) != 1 || tree.Children[0].Kind != "folder" || len(tree.Children[0].Children) != 2 {
		t.Fatalf("tree: %+v", tree.Children)
	}
	// Leftover temp files from atomic writes must not remain.
	matches, _ := filepath.Glob(filepath.Join(a.root, "Work", "*", ".tmp-*"))
	if len(matches) != 0 {
		t.Fatalf("temp files left: %v", matches)
	}
}

func TestImportAndMermaid(t *testing.T) {
	a := testApp(t)
	doc, _ := a.CreateDoc("", "D")
	src := filepath.Join(t.TempDir(), "arch.png")
	os.WriteFile(src, []byte("png"), 0o644)
	bad := filepath.Join(t.TempDir(), "notes.txt")
	os.WriteFile(bad, []byte("x"), 0o644)

	ds, err := a.ImportFiles(doc, []string{src, src, bad})
	if err != nil {
		t.Fatal(err)
	}
	if len(ds) != 2 || ds[0].File != "assets/arch.png" || ds[1].File != "assets/arch 2.png" || ds[0].Kind != "image" {
		t.Fatalf("imported: %+v", ds)
	}
	m, err := a.AddMermaid(doc, "graph TD; A-->B", "Flow")
	if err != nil || m.File != "assets/Flow.mmd" || m.Kind != "mermaid" {
		t.Fatalf("mermaid: %+v %v", m, err)
	}
	if err := a.DeleteAsset(doc, ds[0].File); err != nil {
		t.Fatal(err)
	}
}

func TestPathsCannotEscapeLibrary(t *testing.T) {
	a := testApp(t)
	for _, p := range []string{"../x", "a/../../x", "/../etc"} {
		if _, err := a.abs(p); err == nil {
			t.Errorf("abs(%q) should fail", p)
		}
	}
	if _, err := a.Rename("", "x"); err == nil {
		t.Error("renaming the library root should fail")
	}
	if err := a.Trash("."); err == nil {
		t.Error("trashing the library root should fail")
	}
}
