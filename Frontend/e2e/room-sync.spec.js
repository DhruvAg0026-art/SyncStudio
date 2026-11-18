import { randomBytes } from "node:crypto"
import { expect, test } from "@playwright/test"

test("two browser contexts see the same collaborative document", async ({ browser, baseURL }) => {
  test.setTimeout(90_000)
  const room = `e2e-${randomBytes(4).toString("hex")}`
  const ownerContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  const guestPage = await guestContext.newPage()

  try {
    await ownerPage.goto(baseURL)
    await ownerPage.getByPlaceholder("Enter your username").fill("Owner")
    await ownerPage.getByPlaceholder("Room name").fill(room)
    await ownerPage.getByRole("button", { name: "Create room with this name" }).click()
    await expect(ownerPage.getByText(`room: ${room}`)).toBeVisible()
    await expect(ownerPage.getByText("Connected")).toBeVisible()

    await guestPage.goto(`/?room=${room}&mode=doc`, { waitUntil: "domcontentloaded" })
    await guestPage.getByPlaceholder("Enter your username").fill("Guest")
    await guestPage.getByRole("button", { name: "Join room" }).click()
    await expect(guestPage.getByText(`room: ${room}`)).toBeVisible()
    await expect(guestPage.getByText("Connected")).toBeVisible()

    const ownerEditor = ownerPage.locator(".tiptap[contenteditable='true']")
    const guestEditor = guestPage.locator(".tiptap[contenteditable='true']")
    await expect(ownerEditor).toBeVisible()
    await expect(guestEditor).toBeVisible()
    await guestEditor.fill("SyncStudio browser sync works")
    await expect(ownerEditor).toContainText("SyncStudio browser sync works")
  } finally {
    await guestContext.close()
    await ownerContext.close()
  }
})
