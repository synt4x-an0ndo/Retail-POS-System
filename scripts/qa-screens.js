// Dev-only QA: visits the admin screens of an already-seeded test database (run qa-flow.js first), then the login screen.
window.__qa = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const nav = async (label) => {
    const el = [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.trim().startsWith(label) || b.title === label)
    if (!el) throw new Error('No nav: ' + label)
    el.click()
    await sleep(1000)
  }
  const ensureLogin = async () => {
    const st = await window.pos.invoke('auth.status')
    if (!st.data.user) await window.pos.invoke('auth.login', { username: 'owner', secret: 'secret1' })
  }
  return {
    phases: [
      async () => (await ensureLogin(), 'logged in'),
      async () => (await nav('Team'), 'team'),
      async () => (await nav('Backup'), 'backup'),
      async () => (await nav('Activity log'), 'activity'),
      async () => {
        await nav('Inventory')
        const b = [...document.querySelectorAll('.seg button')].find((x) => x.textContent === 'Low & out')
        b.click()
        await sleep(700)
        return document.querySelectorAll('tbody tr').length + ' low rows'
      },
      async () => {
        await window.pos.invoke('auth.logout')
        return 'logged out'
      },
      async () => 'login screen'
    ]
  }
})()
