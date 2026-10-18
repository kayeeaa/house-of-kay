const express = require('express')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const app = express()

const pub = (rel) => path.join(__dirname, 'public', rel)
const CANONICAL_HOST = 'www.house-of-kay.co.uk'

const hostname = (req) => (req.hostname || '').toLowerCase()

app.use((req, res, next) => {
  const host = hostname(req)

  if (req.path === '/' || req.path === '/index.html') {
    const target = host === 'house-of-kay.co.uk' || host === CANONICAL_HOST
      ? `https://${CANONICAL_HOST}/voxie`
      : '/voxie'

    return res.redirect(host ? 301 : 302, target)
  }

  if (host === 'house-of-kay.co.uk') {
    return res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`)
  }

  return next()
})

// Voxie content: one file per item/pet/location/mission. The game imports every file listed here,
// so adding content is just dropping a file into the folder.
const listVoxieContent = (folder) => {
  try { return fs.readdirSync(pub(`voxie/content/${folder}`)).filter(name => name.endsWith('.js')).sort() }
  catch (error) { return [] }
}
app.get('/voxie/content-manifest.json', (req, res) => {
  res.set('Cache-Control', 'no-cache')
  res.json({
    items: listVoxieContent('items'), pets: listVoxieContent('pets'),
    locations: listVoxieContent('locations'), missions: listVoxieContent('missions'),
    bundle: `/voxie/content-bundle.js?v=${voxieContentBundle().version}`
  })
})

// Every content file in ONE download, so the game doesn't fetch ~750 files one by one. Each file becomes a function
// that returns its export default, so content/loader.js can still check each one on its own and skip a broken one.
// Made once (content only changes with a deploy, which restarts the server). The version is a hash of the contents,
// so browsers keep it for a year and fetch the new one after a deploy.
let voxieBundleCache = null
const voxieContentBundle = () => {
  if (voxieBundleCache) return voxieBundleCache
  const folder = (name) => listVoxieContent(name).map(file => {
    const source = fs.readFileSync(pub(`voxie/content/${name}/${file}`), 'utf8').replace(/^export default /m, 'return ')
    return `[${JSON.stringify(file)}, () => {\n${source}\n}]`
  }).join(',\n')
  const code = `export default {\n${['locations', 'pets', 'items', 'missions'].map(name => `${name}: [\n${folder(name)}\n]`).join(',\n')}\n};\n`
  voxieBundleCache = { code, version: crypto.createHash('sha256').update(code).digest('hex').slice(0, 16) }
  return voxieBundleCache
}
app.get('/voxie/content-bundle.js', (req, res) => {
  const bundle = voxieContentBundle()
  res.type('text/javascript')
  res.set('Cache-Control', req.query.v === bundle.version ? 'public, max-age=31536000, immutable' : 'no-cache')
  res.send(bundle.code)
})

app.get('/voxie', (req, res) => res.sendFile(pub('voxie/index.html')))

// The family planner, the Snap game and the menu that linked them have gone: old links go to Voxie.
app.use(['/menu', '/slap-war', '/planner'], (req, res) => res.redirect(301, '/voxie'))

app.use(express.static(pub('')))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
