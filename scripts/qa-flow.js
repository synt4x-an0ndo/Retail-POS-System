// QA flow run inside the renderer by the dev-only runner (TRB_QA_SCRIPT). Uses only the public window.pos bridge and the UI.
// Each phase runs after a page reload; a screenshot is saved after each phase.
window.__qa = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const inv = async (c, p) => {
    const r = await window.pos.invoke(c, p)
    if (!r.ok) throw new Error(c + ': ' + r.message)
    return r.data
  }
  const clickText = async (text, sel = 'button') => {
    const el = [...document.querySelectorAll(sel)].find((b) => b.textContent.trim().startsWith(text))
    if (!el) throw new Error('No element: ' + text)
    el.click()
    await sleep(600)
  }
  const typeInto = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const pressEnter = (input) => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
  const nav = (label) => clickText(label, '.nav-item')

  return {
    phases: [
      // 1. First-time setup and catalogue through the real IPC bridge.
      async () => {
        const st = await inv('auth.status')
        if (!st.setupDone) {
          await inv('setup.complete', { shopName: 'Raw Threads Dhanmondi', address: 'Road 27, Dhanmondi, Dhaka', phone: '01700-000000', receiptFooter: 'Exchange within 7 days with receipt.', ownerName: 'Shop Owner', username: 'owner', password: 'secret1', pin: '1234' })
        } else if (!st.user) {
          await inv('auth.login', { username: 'owner', secret: 'secret1' })
        }
        const lk = await inv('catalog.lookups')
        if (!lk.sizes.length) {
          const men = await inv('catalog.saveCategory', { name: 'Men', code: 'MEN', active: true })
          const shirts = await inv('catalog.saveCategory', { name: 'Shirts', code: 'SHRT', parentId: men.id, active: true })
          const pants = await inv('catalog.saveCategory', { name: 'Jeans', code: 'JNS', parentId: men.id, active: true })
          const sizes = []
          for (const [i, s] of ['S', 'M', 'L', 'XL'].entries()) sizes.push(await inv('catalog.saveSize', { name: s, sortOrder: i * 10 }))
          const waist = []
          for (const [i, s] of ['30', '32', '34'].entries()) waist.push(await inv('catalog.saveSize', { name: s, sortOrder: 100 + i * 10 }))
          const black = await inv('catalog.saveColor', { name: 'Black', code: 'BLK', sortOrder: 1 })
          const white = await inv('catalog.saveColor', { name: 'White', code: 'WHT', sortOrder: 2 })
          const blue = await inv('catalog.saveColor', { name: 'Blue', code: 'BLU', sortOrder: 3 })
          const shirtVariants = []
          for (const c of [black, white]) for (const s of sizes) shirtVariants.push({ sizeId: s.id, colorId: c.id, costPrice: 650, sellPrice: 1250, reorderLevel: 2, openingQty: s === sizes[3] ? 1 : 6, active: true })
          await inv('catalog.saveProduct', { name: 'Oxford Cotton Shirt', brand: 'Raw Threads', categoryId: shirts.id, active: true, variants: shirtVariants })
          await inv('catalog.saveProduct', {
            name: 'Slim Fit Denim',
            brand: 'Raw Threads',
            categoryId: pants.id,
            active: true,
            variants: waist.map((w) => ({ sizeId: w.id, colorId: blue.id, costPrice: 900, sellPrice: 1850, reorderLevel: 2, openingQty: 4, active: true }))
          })
          await inv('users.save', { name: 'Rahim Uddin', username: 'rahim', password: 'cash123', pin: '5555', roleId: 'role-cashier', discountLimitPct: 10, active: true })
        }
        const v = await inv('catalog.searchVariants', { text: 'Oxford' })
        return `seeded; first barcode ${v[0].barcode}`
      },
      // 2. Checkout: scan three tags (two identical) through the scan box.
      async () => {
        await nav('Checkout')
        const shirts = await inv('catalog.searchVariants', { text: 'Oxford' })
        const denim = await inv('catalog.searchVariants', { text: 'Denim' })
        const box = document.querySelector('.scan-box input')
        for (const code of [shirts[1].barcode, shirts[1].barcode, denim[1].barcode]) {
          typeInto(box, code)
          await sleep(150)
          pressEnter(box)
          await sleep(500)
        }
        const rows = document.querySelectorAll('.cart-line').length
        if (rows !== 2) throw new Error('expected 2 cart lines, got ' + rows)
        await clickText('Exact')
        await sleep(700) // draft autosave
        return 'cart has 2 lines (shirt x2, denim x1), cash entered'
      },
      // 3. After a reload (simulated crash) the cart is recovered; resume, pay cash, complete.
      async () => {
        await nav('Checkout')
        await sleep(600)
        if (!document.querySelector('.banner.warn')) throw new Error('recovery banner not shown')
        await clickText('Resume')
        await clickText('Exact')
        await clickText('Charge')
        await sleep(1800)
        const ok = document.querySelector('.done')
        if (!ok) throw new Error('no success view; toasts: ' + [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '))
        return ok.querySelector('h2').textContent
      },
      // 4. Overview dashboard.
      async () => {
        await nav('Overview')
        await sleep(1200)
        return 'revenue ' + document.querySelector('.kpi .value')?.textContent
      },
      // 5. Products list.
      async () => {
        await nav('Products')
        await sleep(800)
        return document.querySelectorAll('tbody tr').length + ' product rows'
      },
      // 6. Product detail sheet, barcodes tab.
      async () => {
        await nav('Products')
        await sleep(700)
        document.querySelector('tbody tr.click').click()
        await sleep(900)
        await clickText('Barcodes', '.tabs button')
        await sleep(900)
        return document.querySelectorAll('.barcode svg').length + ' barcodes rendered'
      },
      // 7. Inventory.
      async () => {
        await nav('Inventory')
        await sleep(900)
        return document.querySelectorAll('tbody tr').length + ' stock rows'
      },
      // 8. Transactions + invoice sheet with receipt preview.
      async () => {
        await nav('Transactions')
        await sleep(800)
        document.querySelector('tbody tr.click').click()
        await sleep(1400)
        const host = document.querySelector('.receipt-paper div[style]')
        return 'receipt preview ' + (host && host.shadowRoot ? 'rendered' : 'missing')
      },
      // 9. Reports, profit tab.
      async () => {
        await nav('Reports')
        await sleep(600)
        await clickText('Profit', '.tabs button')
        await sleep(1200)
        return 'profit ' + [...document.querySelectorAll('.kpi .value')].map((e) => e.textContent).join(' | ')
      },
      // 10. Settings → printers.
      async () => {
        await nav('Settings')
        await sleep(500)
        await clickText('Printers', '.subnav button')
        await sleep(800)
        return 'settings ok'
      },
      // 11. Product editor (new).
      async () => {
        await nav('Products')
        await sleep(600)
        await clickText('New product')
        await sleep(600)
        document.querySelectorAll('.pickchip')[1]?.click()
        document.querySelectorAll('.pickchip')[2]?.click()
        await sleep(400)
        return 'editor open'
      }
    ]
  }
})()
