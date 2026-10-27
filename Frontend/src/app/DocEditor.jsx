import { useEffect, useMemo, useState } from "react"
import { useEditor, EditorContent, useEditorState } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Collaboration from "@tiptap/extension-collaboration"
import CollaborationCaret from "@tiptap/extension-collaboration-caret"
import TextAlign from "@tiptap/extension-text-align"
import Placeholder from "@tiptap/extension-placeholder"
import TurndownService from "turndown"

// -----------------------------
// Title (synced through a Y.Text so concurrent edits merge)
// -----------------------------

function TitleInput({ ydoc }) {
  const yTitle = useMemo(() => ydoc.getText("title"), [ydoc])
  const [value, setValue] = useState(() => yTitle.toString())

  useEffect(() => {
    const sync = () => setValue(yTitle.toString())
    sync()
    yTitle.observe(sync)
    return () => yTitle.unobserve(sync)
  }, [yTitle])

  const handleChange = (e) => {
    const next = e.target.value
    const prev = yTitle.toString()

    // Only send the part that changed
    let start = 0
    while (start < prev.length && start < next.length && prev[start] === next[start]) {
      start++
    }
    let endPrev = prev.length
    let endNext = next.length
    while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
      endPrev--
      endNext--
    }

    ydoc.transact(() => {
      if (endPrev > start) yTitle.delete(start, endPrev - start)
      if (endNext > start) yTitle.insert(start, next.slice(start, endNext))
    })
  }

  return (
    <input
      value={value}
      onChange={handleChange}
      placeholder="Untitled document"
      maxLength={120}
      className="
        bg-transparent text-white text-lg font-semibold outline-none
        px-2 py-1 rounded border border-transparent
        hover:border-gray-600 focus:border-amber-300
        min-w-0 flex-1
      "
    />
  )
}

// -----------------------------
// Toolbar
// -----------------------------

function Btn({ onClick, active, title, children, className = "" }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      // keep the editor selection when clicking toolbar buttons
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`
        min-w-8 h-8 px-2 rounded text-sm flex items-center justify-center
        ${active ? "bg-amber-50 text-gray-950" : "text-gray-200 hover:bg-gray-700"}
        ${className}
      `}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="w-px h-5 bg-gray-700 mx-1" />
}

function Toolbar({ editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      code: editor.isActive("code"),
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      blockquote: editor.isActive("blockquote"),
      codeBlock: editor.isActive("codeBlock"),
      link: editor.isActive("link"),
      alignLeft: editor.isActive({ textAlign: "left" }),
      alignCenter: editor.isActive({ textAlign: "center" }),
      alignRight: editor.isActive({ textAlign: "right" }),
      alignJustify: editor.isActive({ textAlign: "justify" }),
      heading: [1, 2, 3].find((level) => editor.isActive("heading", { level })) || 0,
    }),
  })

  const chain = () => editor.chain().focus()

  const setLink = () => {
    const previous = editor.getAttributes("link").href || ""
    const url = window.prompt("Link URL", previous)
    if (url === null) return
    if (url.trim() === "") {
      chain().extendMarkRange("link").unsetLink().run()
    } else {
      chain().extendMarkRange("link").setLink({ href: url.trim() }).run()
    }
  }

  const setHeading = (e) => {
    const level = Number(e.target.value)
    if (level === 0) chain().setParagraph().run()
    else chain().setHeading({ level }).run()
  }

  return (
    <div className="no-print flex flex-wrap items-center gap-1 px-2 py-1 bg-gray-900 border-b border-gray-800">
      <Btn title="Undo (Ctrl+Z)" onClick={() => chain().undo().run()}>↶</Btn>
      <Btn title="Redo (Ctrl+Y)" onClick={() => chain().redo().run()}>↷</Btn>
      <Divider />

      <select
        value={s.heading}
        onChange={setHeading}
        title="Text style"
        className="h-8 rounded bg-gray-800 text-gray-100 text-sm px-2 outline-none"
      >
        <option value={0}>Normal text</option>
        <option value={1}>Heading 1</option>
        <option value={2}>Heading 2</option>
        <option value={3}>Heading 3</option>
      </select>
      <Divider />

      <Btn title="Bold (Ctrl+B)" active={s.bold} onClick={() => chain().toggleBold().run()}>
        <b>B</b>
      </Btn>
      <Btn title="Italic (Ctrl+I)" active={s.italic} onClick={() => chain().toggleItalic().run()}>
        <i>I</i>
      </Btn>
      <Btn title="Underline (Ctrl+U)" active={s.underline} onClick={() => chain().toggleUnderline().run()}>
        <u>U</u>
      </Btn>
      <Btn title="Strikethrough" active={s.strike} onClick={() => chain().toggleStrike().run()}>
        <s>S</s>
      </Btn>
      <Btn title="Inline code" active={s.code} onClick={() => chain().toggleCode().run()} className="font-mono">
        {"</>"}
      </Btn>
      <Btn title="Link" active={s.link} onClick={setLink}>🔗</Btn>
      <Divider />

      <Btn title="Align left" active={s.alignLeft} onClick={() => chain().setTextAlign("left").run()}>≡</Btn>
      <Btn title="Align center" active={s.alignCenter} onClick={() => chain().setTextAlign("center").run()}>☰</Btn>
      <Btn title="Align right" active={s.alignRight} onClick={() => chain().setTextAlign("right").run()}>≣</Btn>
      <Btn title="Justify" active={s.alignJustify} onClick={() => chain().setTextAlign("justify").run()}>▤</Btn>
      <Divider />

      <Btn title="Bulleted list" active={s.bulletList} onClick={() => chain().toggleBulletList().run()}>•≡</Btn>
      <Btn title="Numbered list" active={s.orderedList} onClick={() => chain().toggleOrderedList().run()}>1.</Btn>
      <Btn title="Quote" active={s.blockquote} onClick={() => chain().toggleBlockquote().run()}>❝</Btn>
      <Btn title="Code block" active={s.codeBlock} onClick={() => chain().toggleCodeBlock().run()} className="font-mono">
        {"{ }"}
      </Btn>
      <Btn title="Divider line" onClick={() => chain().setHorizontalRule().run()}>—</Btn>
    </div>
  )
}

// -----------------------------
// Export helpers
// -----------------------------

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// -----------------------------
// Document editor
// -----------------------------

export default function DocEditor({ ydoc, provider, user, room }) {
  const [exportOpen, setExportOpen] = useState(false)

  const editor = useEditor(
    {
      extensions: [
        // Undo/redo is handled by the Collaboration extension
        StarterKit.configure({
          undoRedo: false,
          link: { openOnClick: false, autolink: true },
        }),
        Placeholder.configure({ placeholder: "Start writing…" }),
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        Collaboration.configure({ document: ydoc, field: "doc" }),
        CollaborationCaret.configure({ provider, user }),
      ],
      editorProps: {
        attributes: { class: "doc-content", spellcheck: "true" },
      },
    },
    [ydoc, provider]
  )

  const stats = useEditorState({
    editor,
    selector: ({ editor }) => {
      const text = editor ? editor.getText().trim() : ""
      return {
        words: text ? text.split(/\s+/).length : 0,
        chars: text.length,
      }
    },
  })

  if (!editor) return null

  const title = () => ydoc.getText("title").toString().trim() || "Untitled document"
  const fileBase = () =>
    title().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || room

  const exportHtml = () => {
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title())}</title>
<style>body{font-family:Georgia,serif;max-width:760px;margin:40px auto;padding:0 16px;line-height:1.6;color:#111}pre{background:#f3f4f6;padding:12px;border-radius:6px;overflow:auto}blockquote{border-left:3px solid #d1d5db;margin-left:0;padding-left:16px;color:#4b5563}</style>
</head>
<body>
<h1>${escapeHtml(title())}</h1>
${editor.getHTML()}
</body>
</html>`
    download(`${fileBase()}.html`, html, "text/html")
  }

  const exportMarkdown = () => {
    const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" })
    const md = `# ${title()}\n\n${turndown.turndown(editor.getHTML())}\n`
    download(`${fileBase()}.md`, md, "text/markdown")
  }

  const exportText = () => {
    download(`${fileBase()}.txt`, `${title()}\n\n${editor.getText({ blockSeparator: "\n\n" })}\n`, "text/plain")
  }

  const run = (fn) => () => {
    setExportOpen(false)
    fn()
  }

  const menuItem = "block w-full text-left px-3 py-2 text-sm text-gray-100 hover:bg-gray-700"

  return (
    <div className="h-full flex flex-col bg-neutral-800">

      {/* TITLE + EXPORT */}
      <div className="no-print flex items-center gap-2 px-3 py-2 bg-gray-900">
        <TitleInput ydoc={ydoc} />

        <div className="relative">
          <button
            type="button"
            onClick={() => setExportOpen((open) => !open)}
            className="h-8 px-3 rounded bg-amber-50 text-gray-950 text-sm font-bold"
          >
            Export ▾
          </button>

          {exportOpen && (
            <div className="absolute right-0 top-9 z-10 w-48 rounded bg-gray-800 border border-gray-700 shadow-lg overflow-hidden">
              <button className={menuItem} onClick={run(exportHtml)}>HTML (.html)</button>
              <button className={menuItem} onClick={run(exportMarkdown)}>Markdown (.md)</button>
              <button className={menuItem} onClick={run(exportText)}>Plain text (.txt)</button>
              <button className={menuItem} onClick={run(() => window.print())}>Print / Save as PDF</button>
            </div>
          )}
        </div>
      </div>

      <Toolbar editor={editor} />

      {/* PAGE */}
      <div className="doc-scroll flex-1 overflow-auto py-6 px-2 bg-neutral-700">
        <div className="doc-page mx-auto bg-white text-gray-900 shadow-xl rounded-sm">
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* FOOTER */}
      <div className="no-print px-3 py-1 bg-gray-900 text-xs text-gray-400 flex gap-4">
        <span>{stats.words} words</span>
        <span>{stats.chars} characters</span>
      </div>
    </div>
  )
}
