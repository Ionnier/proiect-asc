const fs = require('fs')
const jwt = require('jsonwebtoken');
const crypto = require("crypto");
const path = require("path");

const data_path = path.join(__dirname, "data", "users.json")

function generate_salt() { // genereaza salt-ul pentru criptarea parolelor
    return crypto.randomBytes(16).toString('hex')
}

function hash(string, salt) { // hasheaza un string combinat cu un salt folosit pentru evitarea stocarii in plain text a parolelor
    return crypto.createHmac("sha256", salt).update(string).digest('hex');
}

module.exports.createUser = function (userName, userPassword, userEmail) { // creaza un obiect de tip utilizator ce contine un username, parola si email, parola va fi hashata aici
    let salt = generate_salt()
    return Object.assign({ userName, userPassword: hash(userPassword, salt), salt, userEmail })
}

// Initializeaza datele iar in cazul in care acestea nu exista le creeaza, impreuna cu utilizatorul implicit admin admin
try {
    var data = fs.readFileSync(data_path, 'utf-8')
    data = JSON.parse(data)
} catch (error) {
    if (error.code == "ENOENT") {
        data = Object.assign({ users: [module.exports.createUser("admin", "admin", "admin@admin.com")] })
        try {
            fs.writeFileSync(data_path, JSON.stringify(data))
        }
        catch (error) {
            if (error.code == "ENOENT") {
                fs.mkdirSync(path.dirname(data_path), { recursive: true });
                fs.writeFileSync(data_path, JSON.stringify(data))
            } else {
                throw error
            }
        }
    }
    else {
        throw error
    }
}

// Verificarea daca username-ul si parola coincid cu un user, in caz afirmativ returnam datele referitoare la acesta
module.exports.loginUser = function (userName, userPassword) {
    for (let user of data.users) {
        if (user.userName == userName && user.userPassword == hash(userPassword, user.salt)) {
            return user
        }
    }
    return undefined
}

// Verificam daca un utilizator exista, pentru a evita autentificarea cu JWT a unui utilizator sters
module.exports.existsUser = function (userName) {
    for (let user of data.users) {
        if (user.userName == userName) {
            return user
        }
    }
    return undefined
}

// Inregistrarea unui utilizator daca nu exista unul cu acelasi username sau email
module.exports.signUpUser = function (userName, userPassword, userEmail) {
    for (let user of data.users) {
        if (user.userName == userName || user.userEmail == userEmail) {
            return false
        }
    }
    let user = module.exports.createUser(userName, userPassword, userEmail)
    data.users.push(user)
    fs.writeFileSync(data_path, JSON.stringify(data))
    return true
}

// Criptam un id si generam un JWT pentru autentificare
const sign = id => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES
    });
}

// Trimitem token JWT si setam cookie-ul in cazul unei autentificari reusite
const sendToken = async (user, res) => {
    const token = sign(user.userName);
    const cookieOptions = {
        httpOnly: true
    };
    res.cookie('jwt', token, cookieOptions);
    res.json({
        token,
        data: {
            user
        }
    });

}

// Conectarea din API se face apeland functia de login anterioara
exports.login = async (req, res, next) => {
    if (!req.body.userName || !req.body.userPassword) {
        next(new Error('Username or password was not introduced.'));
    }
    let user = module.exports.loginUser(req.body.userName, req.body.userPassword)
    if (user) {
        sendToken(user, res)
    } else {
        next(new Error('Email or password is incorrect.'))
    }
}

// Inregistrarea din API se face apeland functia de login anterioara
exports.signup = async (req, res, next) => {
    try {
        if (!req.body.userEmail || !req.body.userPassword || !req.body.userName) {
            next(new Error('Email, password, user_name was not introduced.'));
        }
        let user = module.exports.signUpUser(req.body.userName, req.body.userPassword, req.body.userEmail);
        if (user == true) {
            res.json({ success: true });
        } else {
            res.json({ success: false });
        }
    } catch (err) {
        next(err);
    }
}

// Protejarea resurselor (cailor) ca sa fie accesate doar de utilizatori conectati 
exports.protect = async (req, res, next) => {
    let token;
    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        token = req.headers.authorization.split(' ')[1];
    }
    if (!token && req.cookies.jwt) {
        token = req.cookies.jwt
    }
    if (!token) {
        return next(new Error('Not logged in.'));
    }
    jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
        if (err) {
            return next(err);
        }
        let user = module.exports.existsUser(decoded.id);
        if (user) {
            req.user = user;
            next();
        } else {
            next('User doesn\'t exist')
        }
    });
}

// Deconectarea se face stergand JWT-ul din token
exports.logout = (req, res) => {
    res.cookie('jwt', 'PROIECT_ASC', {
        expires: new Date(Date.now() + 10 * 1000),
        httpOnly: true
    });
    res.status(200).json({ status: 'success' });
};

// Se verifica daca JWT-ul este valid ca sa se mentina faptul ca utilizatorul a fost conectat
exports.isLoggedIn = async (req, res, next) => {
    if (req.cookies.jwt) {
        try {
            jwt.verify(req.cookies.jwt, process.env.JWT_SECRET, async (err, decoded) => {
                if (err) {
                    return next();
                }
                let user = module.exports.existsUser(decoded.id)
                if (user) {
                    res.locals.user = user
                    return next();
                } else {
                    return next();
                }
            })
        } catch (err) {
            console.log(err);
            return next();
        }
    } else {
        return next();
    }
}