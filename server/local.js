// Local development server: node server/local.js  (on Vercel, api/index.js is used instead)
const path = require('path'), express = require('express'), app = require('./app');
const pub = path.join(__dirname, '../public');
app.use(express.static(pub, { extensions: ['html'] }));
app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html')));
app.listen(process.env.PORT || 3000, () => console.log(`GoranShop on http://localhost:${process.env.PORT || 3000}  (admin: /admin)`));
