/** Follow rendered height changes, including streamed tools and expanded output. */
export function followConversationBottom(
  viewport: HTMLElement,
  content: HTMLElement,
  Observer: typeof ResizeObserver = ResizeObserver,
): () => void {
  let active = true
  const scroll = () => { if (active) viewport.scrollTop = viewport.scrollHeight }
  const observer = new Observer(scroll)
  observer.observe(content)
  observer.observe(viewport)
  scroll()
  return () => { active = false; observer.disconnect() }
}
