import { useEffect, useState } from "react"
import { Editor } from "@monaco-editor/react"
import { MonacoBinding } from "y-monaco"

const LANGUAGES = [
  ["javascript", "JavaScript"],
  ["typescript", "TypeScript"],
  ["python", "Python"],
  ["java", "Java"],
  ["c", "C"],
  ["cpp", "C++"],
  ["csharp", "C#"],
  ["go", "Go"],
  ["rust", "Rust"],
  ["php", "PHP"],
  ["ruby", "Ruby"],
  ["swift", "Swift"],
  ["kotlin", "Kotlin"],
  ["dart", "Dart"],
  ["html", "HTML"],
  ["css", "CSS"],
  ["scss", "SCSS"],
  ["json", "JSON"],
  ["markdown", "Markdown"],
  ["sql", "SQL"],
  ["yaml", "YAML"],
  ["xml", "XML"],
  ["shell", "Shell"],
  ["powershell", "PowerShell"],
  ["r", "R"],
  ["lua", "Lua"],
]

export default function CodeEditor({ ydoc, provider }) {
  const [editor, setEditor] = useState(null)
  const [language, setLanguage] = useState("javascript")

  useEffect(() => {
    if (!editor) return

    const binding = new MonacoBinding(
      ydoc.getText("monaco"),
      editor.getModel(),
      new Set([editor]),
      provider.awareness
    )

    return () => binding.destroy()
  }, [editor, ydoc, provider])

  return (
    <div className="code-editor-shell">
      <div className="code-editor-toolbar">
        <label htmlFor="code-language">Language</label>
        <select
          id="code-language"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          aria-label="Code language"
        >
          {LANGUAGES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <span className="code-language-hint">Syntax highlighting for 26 languages</span>
      </div>
      <div className="code-editor-canvas">
        <Editor
          height="100%"
          language={language}
          theme="vs-dark"
          options={{ fontSize: 14, minimap: { enabled: false }, automaticLayout: true }}
          onMount={(mountedEditor) => setEditor(mountedEditor)}
        />
      </div>
    </div>
  )
}
