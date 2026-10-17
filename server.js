const express = require('express')
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
app.get('/voxie/content-manifest.json', (req, res) => res.json({
  items: listVoxieContent('items'), pets: listVoxieContent('pets'),
  locations: listVoxieContent('locations'), missions: listVoxieContent('missions')
}))

app.get('/voxie', (req, res) => res.sendFile(pub('voxie/index.html')))

// The family planner, the Snap game and the menu that linked them have gone: old links go to Voxie.
app.use(['/menu', '/slap-war', '/planner'], (req, res) => res.redirect(301, '/voxie'))

app.use(express.static(pub('')))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
