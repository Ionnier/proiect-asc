require('dotenv').config()
const express = require('express')
const fs = require('fs')
const userController = require('./userController')
const NodeWebcam = require("node-webcam");
const path = require('path')
const nodemailer = require('nodemailer')
const app = express()
const server = require('http').Server(app);
const io = require('socket.io')(server);
const { ExpressPeerServer } = require('peer')
const peer = ExpressPeerServer(server, {
    debug: true
});
const cookieParser = require('cookie-parser');
const exec = require('child_process').exec;
const { exit } = require('process');

// Uncomment if on Linux
// const Gpio = require('onoff').Gpio;
// const pushButton = new Gpio(19, 'in', 'both');
// const doorlock = new Gpio(21, 'out');

var FREE = true;
var last_photo_date = undefined
function takePicture() {
    return new Promise((resolve, reject) => {
        if (FREE == true) {
            FREE = false
            var opts = {
                width: 1280,
                height: 720,
                quality: 100,
                frames: 1,
                delay: 0,
                saveShots: true,
                // [jpeg, png] support varies
                // Webcam.OutputTypes
                output: "jpeg",
                //Use Webcam.list() for results
                device: false,
                callbackReturn: "location",
                verbose: false
            };
            if (last_photo_date != undefined) {
                fs.readdir(path.join(__dirname, "resources", "img"), function (err, files) {
                    if (err) {
                        return console.log('Unable to scan directory: ' + err);
                    }
                    for (let file of files) {
                        if (file.includes("latest_shot")) {
                            let name = `${last_photo_date}`
                            name += `.${file.slice(-3)}`
                            fs.copyFileSync(path.join(__dirname, "resources", "img", file), path.join(__dirname, "data", name.replace(":", "-")))
                        }
                    }
                });
            }
            // Modulul nu are support pentru path-uri cu spatii deci le adaugam manual si speram sa nu crasheze, pe W10 e okay.
            NodeWebcam.capture("\"" + path.join(__dirname, "resources", "img", "latest_shot") + "\"", opts, function (err, data) {
                FREE = true
                if (err) {
                    console.log(err)
                    resolve(false);
                } else {
                    resolve(true);
                    last_photo_date = new Date().toISOString().replace(":", "-")
                }
            });
        } else {
            console.log(FREE)
            FREE = true
            resolve(false)
        }
    })

}

app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));
app.use(cookieParser());
app.use('/peerjs', peer);

app.use("/resources", express.static(__dirname + "/resources"))
app.set("view engine", "ejs")
app.get("/socket.io.js", (req, res) => {
    res.sendFile(path.join(__dirname, "node_modules", "socket.io", "client-dist", "socket.io.js"))
})
app.get("/client", (req, res) => {
    res.render("pagini/client")
})

app.post('/api/v1/login', userController.login);
app.post('/api/v1/signup', userController.signup);
app.get('/api/v1/logout', userController.logout)

app.get('/api/v1/disconnect', (req, res) => {
    exec('killall -9 firefox')
    res.json({ status: "success" })
});

app.get('/api/v1/takepicture', async (req, res) => {
    res.json({ status: await takePicture() })
})

var GATE = "CLOSED";

// Inchidem poarta trimitand semnalul 0
function close_gate() {
    if (typeof Gpio !== 'undefined') {
        doorlock.writeSync(0);
        GATE = "CLOSED";
    } else {
        GATE = "CLOSED";
    }
}
// Deschidem poarta trimitand semnalul 1
function open_gate() {
    if (typeof Gpio !== 'undefined') {
        doorlock.writeSync(1);
        GATE = "OPEN";
    } else {
        GATE = "OPEN";
    }
}

app.get('/api/v1/switchgate', (req, res) => {
    if (GATE == "CLOSED") {
        open_gate()
    } else {
        close_gate()
    }
    res.json({ status: "success" })
})

app.get("/signup", userController.protect, (req, res) => {
    res.render('pagini/signup')
})

app.get("*", userController.isLoggedIn, (req, res) => {
    if (res.locals.user) {
        res.render("pagini/home", { gate: GATE });
    } else {
        res.render("pagini/login");
    }
})

var mailConfig = {
    host: 'smtp.gmail.com',
    port: 465,
    auth: {
        user: process.env.EMAIL_ACCOUNT,
        pass: process.env.EMAIL_PASSWORD
    }
};
let transporter = nodemailer.createTransport(mailConfig);

function sendMail(destinatar) {
    return new Promise((resolve, reject) => {
        var message = {
            from: `"Videointerfon" <${process.env.EMAIL_ACCOUNT}>`,
            to: destinatar,
            subject: 'Butonul interfonului a fost apasat',
            text: 'Poti verifica cine este pe website.'
        };
        transporter.sendMail(message, (error, info) => {
            if (error) {
                console.log(error)
                reject(error)
            }
            resolve(info.messageId)
        });
    })
}
// sendMail("whatever@tesasdasdasdasdsadasd.asf")

// Setarea port-ului pe care server-ul asculta request-uri
const port = process.env.PORT || 3000
// Specificarea hostname-ului de pe care sa fie accesibil server-ul, implicit datorita securitatii vrem sa ascultam doar 
//in reteaua locala, insa daca vrem putem specifica un DNS si sa ascultam si via Internet(sa lasam oamenii sa intre 
//chiar si cand nu suntem acasa)
const host = process.env.HOST || '0.0.0.0'


// https://github.com/Abhishek07Kalra/VideoCall
io.on("connection", (socket) => {
    socket.on('newUser', (id, room) => {
        socket.join(room);
        socket.broadcast.emit('userJoined', id);
        socket.on('disconnect', () => {
            socket.broadcast.emit('userDisconnect', id);
        })
    })

})


server.listen(port, host, () => {
    console.log(`Listening on port ${port} via ${host}...`)
})

if (typeof Gpio !== 'undefined') {
    pushButton.watch(async function (err, value) {
        if (err) {
            console.error(err);
            return;
        }
        if (value == 1) {
            for (let user of data.users) {
                if (user.userEmail) {
                    try {
                        await sendMail(user.userEmail)
                    }
                    catch (error) {
                        console.log(error)
                    }
                }
            }
            exec("killall -9 firefox")
            exec("firefox localhost:3000/client")
        }
    });
}

process.on('SIGINT', () => {
    if (typeof Gpio !== 'undefined') {
        doorlock.writeSync(0);
        doorlock.unexport();
        pushButton.unexport();
    }
    exit(1);
});

