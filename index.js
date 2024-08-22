const http = require("http")
const express = require("express")
const qrcode = require("qrcode")
const socketIO = require("socket.io")
const { rm } = require("fs")

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys')
const pino = require('pino')

const port = 8000
const app = express()
const server = http.createServer(app)
const io = socketIO(server)

app.use(express.json())
app.use("/assets", express.static(__dirname + "/client/assets"))

app.get("/", (req, res) => {
  res.sendFile("./client/index.html", {
    root: __dirname,
  })
})

let qr
let sock
let connected
let wa

const sendMessageWTyping = async (waSock, msg, jid) => {
  await waSock.presenceSubscribe(jid)
  await delay(500)
  await waSock.sendPresenceUpdate('composing', jid)
  await delay(2000)
  await waSock.sendPresenceUpdate('paused', jid)
  await waSock.sendMessage(jid, msg)
}

function connectionUpdate(update) {
  const setQR = qr => {
    qrcode.toDataURL(qr, (err, url) => {
      sock?.emit("qr", url)
      sock?.emit("log", "QR Code received, please scan!")
    })
  }

  if (update.qr) {
    qr = update.qr
    setQR(qr)
  }

  if (update === 'qr') {
    setQR(qr)
  }

  if (update.connection === 'open' || update === 'connected') {
    connected = true
    qr = ''
    sock?.emit("qrstatus", "./assets/check.svg")
    sock?.emit("log", "WhatsApp terhubung!")
  }

  if (update.connection === 'close') {
    connected = false
    sock?.emit("qrstatus", "./assets/loader.gif")
  }
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('wabill_session')
  const waSock = makeWASocket({
    printQRInTerminal: true,
    browser: ["Wabill", "Chrome", "1.2.0"],
    auth: state,
    logger: pino({
      level: 'error'
    })
  })

  waSock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update
    if (connection === 'close') {
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        connectToWhatsApp()
      } else {
        console.log('Connection closed. You are logged out.')
        rm("./wabill_session", { recursive: true }, (err) => {
          if (err && err.code == "ENOENT") {
            // file doens't exist
            console.info("Folder doesn't exist, won't remove it.");
          } else if (err) {
            console.error("Error occurred while trying to remove folder.");
            console.error(err)
          }
        })
        connectToWhatsApp()
      }
    }

    connectionUpdate(update)
  })

  waSock.ev.on('creds.update', async () => {
    await saveCreds()
  })

  wa = waSock
}

connectToWhatsApp()

io.on("connection", async (socket) => {
  sock = socket
  if (connected) {
    connectionUpdate("connected")
  } else if (qr) connectionUpdate('qr')
})

app.post("/send-message", async (req, res) => {
  const message = req.body.message
  const number = req.body.number

  if (connected) {
    wa.onWhatsApp(number)
      .then(data => {
        if (data[0]?.jid) {
          sendMessageWTyping(wa, { text: message }, data[0].jid)
            .then((result) => {
              res.status(200).json({
                status: true,
                response: result,
              })
            })
            .catch((err) => {
              res.status(500).json({
                status: false,
                response: err,
              })
            })
        } else {
          res.status(500).json({
            status: false,
            response: `Nomor ${number} tidak terdaftar.`,
          })
        }
      })
      .catch(async err => {
        console.log(err)
        if (err?.output?.statusCode === DisconnectReason.connectionClosed) {
          console.log('di sini error ')
        }
      })
  } else {
    res.status(500).json({
      status: false,
      response: `WhatsApp belum terhubung.`,
    })
  }
})

server.listen(port, () => {
  console.log(`Aplikasi berjalan di http://localhost:${port}`)
})