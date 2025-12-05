const e = require('express')

const app = e()
app.use(e.static('./'))
app.listen(8080)
