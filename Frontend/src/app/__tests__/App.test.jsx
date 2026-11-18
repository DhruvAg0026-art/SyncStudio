import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import App from "../App"

const mocks = vi.hoisted(() => ({
  getSessionToken: vi.fn(),
  useCollab: vi.fn(),
}))

vi.mock("../useCollab", () => ({
  colorFor: () => "#60a5fa",
  getSessionToken: mocks.getSessionToken,
  useCollab: mocks.useCollab,
}))

vi.mock("../firebase", () => ({
  auth: null,
  firebaseConfigured: false,
  googleProvider: null,
}))

describe("room entry screen", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/")
    vi.stubEnv("VITE_CONNECT", "http://localhost:3000")
    mocks.getSessionToken.mockResolvedValue("test-session-token")
    mocks.useCollab.mockReturnValue({
      session: null,
      users: [],
      status: "disconnected",
      members: [],
      ownerId: null,
      accessRole: null,
      roomNotice: "",
      leaveRoom: vi.fn(),
      kickMember: vi.fn(),
      deleteRoom: vi.fn(),
    })
  })

  it("shows a password field only when joining a private room", () => {
    render(<App />)

    expect(screen.getByPlaceholderText("Room name")).toBeInTheDocument()
    expect(screen.queryByPlaceholderText("Private room password")).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText("Join private room"))

    expect(screen.getByPlaceholderText("Private room password")).toBeInTheDocument()
  })

  it("creates a password-protected room with the backend contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ room: "private-study-room", privateRoom: true }),
    })
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)

    fireEvent.change(screen.getByPlaceholderText("Enter your username"), {
      target: { value: "Ava" },
    })
    fireEvent.change(screen.getByPlaceholderText("Room name"), {
      target: { value: "private-study-room" },
    })
    fireEvent.click(screen.getByLabelText("Create private room"))
    fireEvent.change(screen.getByPlaceholderText("Private room password (6+ characters)"), {
      target: { value: "secret123" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create room with this name" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const [, options] = fetchMock.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({
      room: "private-study-room",
      privateRoom: true,
      password: "secret123",
    })
    expect(options.headers.authorization).toBe("Bearer test-session-token")
    expect(await screen.findByText("private-study-room", { exact: true })).toBeInTheDocument()
  })

  it("removes one recent room and clears the rest", () => {
    localStorage.setItem("syncstudio-recent-rooms", JSON.stringify([
      { room: "alpha-room", mode: "doc", lastVisited: 2 },
      { room: "beta-room", mode: "code", lastVisited: 1 },
    ]))
    render(<App />)

    expect(screen.getByRole("region", { name: "Recent rooms" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Remove alpha-room from recent rooms" }))

    expect(screen.queryByText("alpha-room")).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem("syncstudio-recent-rooms"))).toEqual([
      { room: "beta-room", mode: "code", lastVisited: 1 },
    ])

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }))
    expect(screen.queryByRole("region", { name: "Recent rooms" })).not.toBeInTheDocument()
    expect(localStorage.getItem("syncstudio-recent-rooms")).toBeNull()
  })
})
