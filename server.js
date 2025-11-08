const e = require('express')

const app = e()
app.use(e.static('./public'))
app.listen(8080)
