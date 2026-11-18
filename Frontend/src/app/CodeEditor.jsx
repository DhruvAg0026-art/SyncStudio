import { useEffect, useState } from "react"
import { Editor } from "@monaco-editor/react"
import { MonacoBinding } from "y-monaco"
import VersionHistory from "./VersionHistory"

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
const RUNNABLE_LANGUAGES = new Set([
  "javascript", "typescript", "python", "java", "c", "cpp", "csharp", "go", "rust",
  "php", "ruby", "swift", "kotlin", "dart", "lua",
])

export default function CodeEditor({
  ydoc,
  provider,
  user,
  theme = "dark",
  readOnly = false,
  autoSaveEnabled = false,
}) {
  const [editor, setEditor] = useState(null)
  const [localUser, setLocalUser] = useState(
    () => provider.awareness.getLocalState()?.user || user || null
  )
  const [language, setLanguage] = useState("javascript")
  const [outputOpen, setOutputOpen] = useState(false)
  const [stdin, setStdin] = useState("")
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState("")
  const [runResult, setRunResult] = useState(null)

  useEffect(() => {
    const updateUser = () => {
      setLocalUser(provider.awareness.getLocalState()?.user || user || null)
    }
    provider.awareness.on("change", updateUser)
    updateUser()
    return () => provider.awareness.off("change", updateUser)
  }, [provider, user])

  useEffect(() => {
    const settings = ydoc.getMap("settings")
    const updateLanguage = () => {
      const sharedLanguage = settings.get("language")
      if (LANGUAGES.some(([value]) => value === sharedLanguage)) {
        setLanguage(sharedLanguage)
      } else if (sharedLanguage == null) {
        if (!readOnly) settings.set("language", "javascript")
      } else {
        setLanguage("javascript")
      }
    }

    settings.observe(updateLanguage)
    updateLanguage()

    return () => settings.unobserve(updateLanguage)
  }, [ydoc, readOnly])

  useEffect(() => {
    const sharedRun = ydoc.getMap("run")
    const updateResult = () => setRunResult(sharedRun.get("result") || null)
    sharedRun.observe(updateResult)
    updateResult()
    return () => sharedRun.unobserve(updateResult)
  }, [ydoc])

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

  const runCode = async () => {
    if (readOnly) return
    setOutputOpen(true)
    setRunning(true)
    setRunError("")
    try {
      const response = await fetch(`${import.meta.env.VITE_CONNECT.replace(/\/+$/, "")}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          language,
          code: ydoc.getText("monaco").toString(),
          stdin,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Code execution failed.")
      ydoc.getMap("run").set("result", {
        ...data,
        language,
        author: provider.awareness.getLocalState()?.user?.name || "A collaborator",
        createdAt: Date.now(),
      })
    } catch (error) {
      setRunError(error.message || "Could not run code.")
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="code-editor-shell">
      <div className="code-editor-toolbar">
        <label htmlFor="code-language">Language</label>
        <select
          id="code-language"
          value={language}
          onChange={(event) => ydoc.getMap("settings").set("language", event.target.value)}
          disabled={readOnly}
          aria-label="Code language"
        >
          {LANGUAGES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <button
          type="button"
          className="run-code-button"
          onClick={runCode}
          disabled={readOnly || running || !RUNNABLE_LANGUAGES.has(language)}
          title={RUNNABLE_LANGUAGES.has(language) ? "Run shared code" : "This language is not supported by the runner"}
        >
          {running ? "Running…" : "Run"}
        </button>
        <button type="button" className="output-toggle" onClick={() => setOutputOpen((open) => !open)}>
          {outputOpen ? "Hide output" : "Output"}
        </button>
        <VersionHistory
          ydoc={ydoc}
          mode="code"
          user={localUser}
          readOnly={readOnly}
          autoSaveEnabled={autoSaveEnabled}
        />
        <span className="code-language-hint">Syntax highlighting for 26 languages</span>
      </div>
      <div className="code-editor-canvas">
        <Editor
          height="100%"
          language={language}
          theme={theme === "light" ? "vs" : "vs-dark"}
          options={{ fontSize: 14, minimap: { enabled: false }, automaticLayout: true, readOnly }}
          onMount={(mountedEditor) => setEditor(mountedEditor)}
        />
      </div>
      {outputOpen && (
        <section className="code-output-panel" aria-label="Code output">
          <div className="code-output-heading">
            <strong>Shared output</strong>
            {runResult && (
              <span>
                Last run by {runResult.author} · {new Date(runResult.createdAt).toLocaleTimeString()}
              </span>
            )}
          </div>
          <label className="code-stdin-label" htmlFor="code-stdin">Standard input (optional)</label>
          <textarea
            id="code-stdin"
            className="code-stdin"
            value={stdin}
            onChange={(event) => setStdin(event.target.value)}
            placeholder="Input passed to the program"
            rows={2}
          />
          {runError && <p className="code-run-error" role="alert">{runError}</p>}
          {runResult ? (
            <pre className="code-output-content">{[
              runResult.stdout && `stdout:\n${runResult.stdout}`,
              runResult.stderr && `stderr:\n${runResult.stderr}`,
              `exit code: ${runResult.exitCode ?? "unknown"}`,
            ].filter(Boolean).join("\n\n")}</pre>
          ) : (
            !runError && <p className="code-output-empty">Run the shared code to see output here.</p>
          )}
        </section>
      )}
    </div>
  )
}
