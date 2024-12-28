const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const cors = require('cors');
const base64js = require('base64-js');
const nodemailer = require('nodemailer');
const admin = require("firebase-admin");
const serviceAccount = require("/home/park/Downloads/talk-793db-firebase-adminsdk-bgy4u-e9f94c1334.json");
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();     // .env 환경 변수 사용(DB, SMTP)

admin.initializeApp({
	credential: admin.credential.cert(serviceAccount),
});

const app = express();
app.use(cors());
app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(bodyParser.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({server});

const rooms = {};

console.log(`DB: ${process.env.DB_PASSWORD}`);

const db = mysql.createConnection({
    'host': 'localhost',
	'user': 'root',
	'password': process.env.DB_PASSWORD,
	'database': process.env.DB_NAME,
	'charset': 'utf8mb4',
});

db.connect((err) => {
    if (err) {
        console.error('DB connection error:', err);
    } else {
        console.log('Connected to DB');
    }
});

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,  // 587 false일 시
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
    }
});

// 파일 저장을 위한 설정
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, '/home/park/uploads');  // 업로드 디렉토리
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));  // 파일 이름 설정
    }
});

// 파일 업로드 미들웨어
const upload = multer({ storage: storage });

// 파일 업로드 엔드포인트
app.post('/upload/:description', upload.single('file'), (req, res) => {
    const description = req.params.description;
    const userId = parseInt(req.query.userId);
    const roomId = parseInt(req.query.roomId);
    const type = req.query.type;
    
    if (req.file) {
        // 서버에 저장된 파일의 URL을 생성
        const fileUrl = `uploads/${req.file.filename}`;
        const query = 'insert into message (room_id, sender_id, message_text, file_type) values (?,?,?,?)';
        db.query(query, [roomId, userId, fileUrl, type], (err, results) => {
            if (err) {
                console.error('Error', err);
            }
        });
        // 응답으로 URL을 반환
        res.json({ fileUrl: fileUrl });
    } else {
        res.status(400).send('No file uploaded');
    }
});

app.get('/uploads/:filename', (req, res) => {       // 미디어 파일 전송
    const filename = req.params.filename;
    const filePath = path.join('/home/park/uploads', filename);
    
    if(!fs.existsSync(filePath)) {
        return res.status(404).send('File not found');
    }
    
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

    const range = req.headers.range;
    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize || start > end) {
            return res.status(416).header('Content-Range', `bytes */${fileSize}`).send();
        }

        const chunkSize = end - start + 1;
        const fileStream = fs.createReadStream(filePath, { start, end });

        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': 'application/octet-stream'
        });

        fileStream.pipe(res);
        fileStream.on('error', (err) => {
            console.error('Stream error:', err);
            res.status(500).send('Error streaming file');
        });
    } else {
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': 'application/octet-stream'
        });

        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        fileStream.on('error', (err) => {
            console.error('Stream error:', err);
            res.status(500).send('Error streaming file');
        });
    }
});

app.post('/email', (req, res) => {      // 이메일 인증 번호 전송
    const { email, number } = req.body;
    if(!email || !number) {
        return res.status(400).json({error: 'Missing required fields'});
    }
    const mailOptions = {
        from: 'haperd13@naver.com',
        to: email,
        subject: 'SocialApp 이메일 인증',
        text: `인증 코드는: ${number}`
    };
    
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            return res.status(500).send('메일 발송 실패');
        }
        res.status(200).send('인증 이메일이 발송되었습니다.');
    });
});

app.post('/messages', (req, res) => {       // 채팅 메시지 저장
    const {room_id, sender_id, message_text} = req.body;
    if(!room_id || !sender_id || !message_text) {
        return res.status(400).json({error: 'Missing required fields'});
    }
    const query = 'insert into message (room_id, sender_id, message_text) values (?,?,?)';
    db.query(query, [room_id, sender_id, message_text], (err, results) => {
        if (err) {
            console.error('Error',err);
        }
        res.status(200).send('Message sent');
    });
});

app.post('/join', (req, res) => {       // 회원가입
    const {name, email, password} = req.body;
    if(!name || !email || !password) {
        return res.status(400).json({error: 'Missing required fields'});
    }
    const query = 'insert into users (name, email, password) values (?,?,?)';
    db.query(query, [name, email, password], (err, results) => {
        if (err) {
            console.error('Error', err);
            return res.status(500).json({error: 'Database error'});
        }
        res.status(200).send('Message sent');
    });
});

app.post('/friends', (req, res) => {    // 채팅방에 인원 추가
    const {id, friend_id} = req.body;
    if(!id || !friend_id) {
        return res.status(400).json({error: 'Missing required fields'});
    }
    const query = 'insert into chatroom (created_by, friend_id) values (?,?)';
    db.query(query, [id, friend_id], (err, results) => {
        if (err) {
            console.error('Error',err);
            return res.status(500).json({error: 'Database error'});
        }
        res.status(200).send('Message sent');
    });
});

app.post('/rooms', (req, res) => {  // 채팅방에 인원 추가
    const {user_id, friend_id} = req.body;
    if(!user_id || !friend_id) {
        return res.status(400).json({error: 'Missing required fields'});
    }
    const query = 'insert into chatroom(created_by, friend_id) values(?, ?);'
    db.query(query, [user_id, friend_id], (err, results) => {
        if (err) {
            console.error('Error',err);
            return res.status(500).json({error: 'Database error'});
        }
        res.status(200).send('Message sent');
    });
});

app.post('/storys', (req, res) => {     // 스토리 저장
    const {user_id, name, image, post} = req.body;
    if(!user_id || !name || !post) {
        return res.status(400).json({error: 'Missing required fields'});
    }
    const query = 'insert into story(user_id, name, profile_img, post) values(?,?,?,?);'
    db.query(query, [user_id, name, image, post], (err, results) => {
        if(err) {
            console.error('Error', err);
            return res.status(500).json({error: 'Database error'});
        }
        const storyId = results.insertId;
        res.status(201).json({id: storyId});
    });
});

app.post('/images', (req, res) => {     // 스토리 이미지 저장
    const {id, image} = req.body;
    if(!id || !image) {
        return res.status(400).json({error: 'Missing required fields'});
    }
    const query = 'insert into images(id, image) values(?,?);'
    db.query(query, [id, image], (err, results) => {
        if (err) {
            console.error('Error',err);
            return res.status(500).json({error: 'Database error'});
        }
        res.status(200).send('Message sent');
    });
});

app.post('/likes', (req, res) => {      // 좋아요 저장
    const{id, user_id} = req.body;
    if(!id || !user_id) {
        return res.status(400).json({error: 'Missing required fields'});
    }
    const query = 'insert into likes(story_id, user_id) values(?, ?);'
    db.query(query, [id, user_id], (err, results) => {
        if (err) {
            console.error('Error',err);
            return res.status(500).json({error: 'Database error'});
        }
        res.status(200).send('Message sent');
    });
});

app.post('/addchat', (req, res) => {
    const {myId, friendId} = req.body;
    if(!myId || !friendId) {
        return res.status(400).json({error: 'Missing required fields'});
    }
    const query = 'insert into userchatroom (user_id, room_id) values(?, (select room_id from chatroom where (created_by = ? and friend_id = ?) or (created_by = ? and friend_id = ? ) limit 1 ))';
    db.query(query, [myId, myId, friendId, friendId, myId], (err, results) => {
        if (err) {
            console.error('Error',err);
            return res.status(500).json({error: 'Database error'});
        }
        res.status(200).send('Message sent');
    });
});

app.post('/group', (req, res) => {
    const {user_id} = req.body;
    const title = req.query.title;
    let query;
    if(!user_id) {
        return res.status(400).json({error: 'Missing required fields'});
    }
    if(title == "") {
        const query = 'insert into chatroom(created_by, friend_id, g_check) values(?, ?, 1);'
        db.query(query, [user_id, user_id], (err, results) => {
            if (err) {
                console.error('Error',err);
                return res.status(500).json({error: 'Database error'});
            }
            const roomId = results.insertId;
            res.status(201).json({id: roomId});
        });
    } else {
        const query = 'insert into chatroom(room_name, created_by, friend_id, g_check) values(?, ?, ?, 1);'
        db.query(query, [title,user_id, user_id], (err, results) => {
            if (err) {
                console.error('Error',err);
                return res.status(500).json({error: 'Database error'});
            }
            const roomId = results.insertId;
            res.status(201).json({id: roomId});
        });
    }
});

app.post('/groups', (req, res) => {
    const {roomId, userId} = req.body;
    if(!roomId || !userId) {
        return res.status(400).json({error: 'Missing required fields'});
    }
    const query = 'insert into userchatroom(user_id, room_id) values(?, ?)';
    db.query(query, [userId, roomId], (err, results) => {
        if (err) {
            console.error('Error',err);
            return res.status(500).json({error: 'Database error'});
        }
        res.status(200).send('Message sent');
    });
});

app.post('/tokens', (req, res) => {
    const { userId, token } = req.body;
    if (!token || !userId) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const deleteQuery = 'DELETE FROM usertoken WHERE token = ?';
   
    db.query(deleteQuery, [token], (err, deleteResults) => {
        if (err) {
            console.error('Error deleting token:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        const insertQuery = 'INSERT INTO usertoken (user_id, token) VALUES (?, ?)';
       
        db.query(insertQuery, [userId, token], (err, insertResults) => {
            if (err) {
                console.error('Error inserting token:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            res.status(200).send('Token inserted successfully');
        });
    });
});
    
app.post('/comments', (req, res) => {
    const{story_id, answer_id, comment, user_id} = req.body;
    if(!story_id || !comment || !user_id) {
        return res.status(400).json({error: 'Missing required fields'});
    }
    const query = 'insert into comments(story_id, answer_id, comment, user_id) values(?, ?, ?, ?);'
    db.query(query, [story_id, answer_id, comment, user_id], (err, results) => {
        if (err) {
            console.error('Error',err);
            return res.status(500).json({error: 'Database error'});
        }
        res.status(200).send('Message sent');
    });
});

app.post('/deltoken', (req,res) => {
    const {token} = req.body;
    if(!token) {
        return res.status(400).json({error: 'Missing required fields'});
    }
    const query = 'delete from usertoken where token = ?';
    db.query(query, [token], (err, results) => {
        if (err) {
            console.error('Error',err);
            return res.status(500).json({error: 'Database error'});
        }
        res.status(200).send('Delete token');
    });
});

app.post('/user/blocking/:userId', (req, res) => {
    const userId = req.params.userId;
    const myId = req.query.myId;
    const query = 'insert into userblocked values(?,?)';
    db.query(query, [myId, userId], (err, results) => {
        if (err) {
            console.error('Error',err);
            return res.status(500).json({error: 'Database error'});
        }
        res.status(200).send('Delete comments');
    });
});

app.delete('/likes/:userId/:storyId', (req,res) => {
    const userId = req.params.userId;
    const storyId = req.params.storyId;
    
    const query = 'delete from likes where user_id = ? and story_id = ?;'
    db.query(query, [userId, storyId], (err, results) => {
        if (err) {
            console.error('Error',err);
            return res.status(500).json({error: 'Database error'});
        }
        res.status(200).send('Delete like');
    });
});

app.delete('/story/:story_id', (req,res) => {
    const story_id = req.params.story_id;
    
    const query = 'delete from story where id = ?';
    db.query(query, [story_id], (err, results) => {
        if (err) {
            console.error('Error',err);
            return res.status(500).json({error: 'Database error'});
        }
        res.status(200).send('Delete story');
    });
});

app.delete('/comments/:commentId', (req, res) => {
    const commentId = req.params.commentId;
    const query = 'with recursive CommentAll as ( select id from comments where id = ? union all select c.id from comments c join CommentAll ca on c.answer_id = ca.id) delete from comments where id in(select id from CommentAll);';
    db.query(query, [commentId], (err, results) => {
        if (err) {
            console.error('Error',err);
            return res.status(500).json({error: 'Database error'});
        }
        res.status(200).send('Delete comments');
    });
});

app.delete('/user/unblock/:userId', (req, res) => {
    const userId = req.params.userId;
    const myId = req.query.myId;
    const query = 'delete from userblocked where user_id = ? and blocked_id = ?';
    db.query(query, [myId, userId], (err, results) => {
        if (err) {
            console.error('Error',err);
            return res.status(500).json({error: 'Database error'});
        }
        res.status(200).send('Delete comments');
    });
});

app.put('/revise/password', (req,res) => {
    const { email, password } = req.body;
    if(!email || !password) {
        return res.status(400).json({error: 'Missing required fields'});
    }
    const query = 'update users set password = ? where email = ?';
    db.query(query, [password, email], (err, results) => {
        if (err) {
            console.error('Error',err);
            return res.status(500).json({error: 'Database error'});
        }
        res.status(200).send('password changed');
    });
});

app.put('/revise/story', (req,res) => {
    const { storyId, post } = req.body;
    if(!storyId || !post) {
        return res.status(400).json({error: 'Missing required fields'});
    }
    const query = 'update story set post = ? where id = ?';
    db.query(query, [post, storyId], (err, results) => {
        if (err) {
            console.error('Error',err);
            return res.status(500).json({error: 'Database error'});
        }
        res.status(200).send('story changed');
    });
});

app.get('/users/myfriends/:userId', (req,res) => {
    const userId = req.params.userId;
    const query = 'select if(b.created_by = ?, friend_id, created_by) as friend_id, a.room_id from userchatroom a join (select * from chatroom where created_by = ? or friend_id = ?) b on a.room_id = b.room_id where user_id = ?';
    db.query(query, [userId, userId, userId, userId], (err, results) => {
        if(err) {
            console.error('Failed to load friends:', err);
            res.status(500).send('Server error');
        } else {
            res.json(results);
        }
    });
});


app.get('/users/profile/:userId', (req,res) => {
    const userId = req.params.userId;
    
    const query = 'select * from users where id = ? union select a.* from users a join (select if(created_by = ?, friend_id, created_by) as friend_id from chatroom where created_by = ? or friend_id = ?) b on a.id = b.friend_id or a.id = ? group by a.id';
    db.query(query, [userId, userId, userId, userId, userId], (err, results) => {
        if(err) {
            console.error('Failed to fetch friends:', err);
            res.status(500).send('Server error');
        } else {
            if(results.length > 0) {
             const users = results.map(user => {
               return {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    password: user.password,
                    message: user.message,
                    profile_img: user.profile_img ? user.profile_img.toString() : null
                };
            });
            res.json(users);
            } else {
                 return res.status(204).send();
            }
        }
    });
});

app.get('/users/profile/one/:userId', (req,res) => {
    const user_id = req.params.userId;
    
    const query = 'select * from users where id = ?';
    db.query(query, [user_id], (err, results) => {
        if(err) {
            console.error('Failed to fetch friends:', err);
            res.status(500).send('Server error');
        } else {
            if(results.length > 0) {
             const users = results.map(user => {
               return {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    password: user.password,
                    message: user.message,
                    profile_img: user.profile_img ? user.profile_img.toString() : null
                };
            });
            res.json(users);
            } else {
                 return res.status(204).send();
            }
        }
    });
});

app.get('/preview/images/:userId', (req,res) => {
    const userId = req.params.userId;
    const page = parseInt(req.query.page) || 1;
    const size = parseInt(req.query.size) || 10;
    const offset = (page - 1) * size;
    
    const query = 'select a.* from images a join (select id, created_at from story where user_id = ? limit ? offset ?) b on a.id = b.id order by created_at desc';
    db.query(query, [userId, size, offset], (err, results) => {
        if(err) {
            console.error('Failed to fetch friends:', err);
            res.status(500).send('Server error');
        } else {
            if(results.length > 0) {
             const stories = results.map(story => {
               return {
                    id: story.id,
                    image: story.image ? story.image.toString() : null
                };
            });
            res.json(stories);
            } else {
                 return res.status(204).send();
            }
        }
    });
});

app.get('/preview/likes/:userId', (req,res) => {
    const userId = req.params.userId;
    const myId = parseInt(req.query.my_id);
    const page = parseInt(req.query.page) || 1;
    const size = parseInt(req.query.size) || 10;
    const offset = (page - 1) * size;
    
    const query = 'select a.story_id, count(*) as num, max(case when a.user_id = ? then true else false end) as me from likes a join story b on a.story_id = b.id where b.user_id = ? group by a.story_id order by b.created_at desc limit ? offset ?';
    
    db.query(query, [myId, userId, size, offset], (err, results) => {
        if(err) {
            console.error('Failed to fetch friends:', err);
            res.status(500).send('Server error');
        } else {
            res.json(results);
        }
    });
});

app.get('/preview/stories/:userId', (req,res) => {
    const userId = req.params.userId;
    const page = parseInt(req.query.page) || 1;
    const size = parseInt(req.query.size) || 10;
    const offset = (page - 1) * size;
    
    const query = 'select * from story where user_id = ? order by created_at desc limit ? offset ?';
    db.query(query, [userId, size, offset], (err, results) => {
        if(err) {
            console.error('Failed to fetch friends:', err);
            res.status(500).send('Server error');
        } else {
            if(results.length > 0) {
             const stories = results.map(story => {
               return {
                    id: story.id,
                    user_id: story.user_id,
                    name: story.name,
                    profile_img: story.profile_img ? story.profile_img.toString() : null,
                    post: story.post,
                    created_at: story.created_at,
                    updated_at: story.updated_at
                };
            });
            res.json(stories);
            } else {
                 return res.json(null);
            }
        }
    });
});


app.get('/users/email/:email', (req,res) => {
    const email = req.params.email;
    
    const query = 'select email from users where email = ?';
    db.query(query, [email], (err, results) => {
        if(err) {
            console.error('Failed to fetch email:', err);
            res.status(500).send('Server error');
        } else {
            res.json(results);
        }
    });
});

app.get('/login/email/:email', (req,res) => {
    const email = req.params.email;
    
    const query = 'select * from users where email = ?';
    db.query(query, [email], (err, results) => {
        if(err) {
            console.error('Failed to fetch email:', err);
            res.status(500).send('Server error');
        }  else {
            if(results.length > 0) {
             const users = results.map(user => {
               return {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    password: user.password,
                    message: user.message,
                    profile_img: user.profile_img ? user.profile_img.toString() : null
                };
            });
            res.json(users);
            } else {
                 return res.json([]);
            }
        }
    });
});

app.get('/storys/:userId', (req,res) => {
    const userId = req.params.userId;
    const page = parseInt(req.query.page) || 1;
    const size = parseInt(req.query.size) || 20;
    const offset = (page - 1) * size;
    
    const query = 'select c.* from story c join (select a.id from users a join (select if(created_by = ?, friend_id, created_by) as friend_id from chatroom where created_by = ? or friend_id = ?) b on a.id = b.friend_id or a.id = ? group by a.id union select id from users where id = ?) d on c.user_id = d.id order by c.created_at desc limit ? offset ?';
    db.query(query, [userId, userId, userId, userId, userId, size, offset], (err, results) => {
        if(err) {
            console.error('Failed to fetch friends:', err);
            res.status(500).send('Server error');
        } else {
            if(results.length > 0) {
             const storys = results.map(story => {
               return {
                    id: story.id,
                    user_id: story.user_id,
                    name: story.name,
                    profile_img: story.profile_img ? story.profile_img.toString() : null,
                    post: story.post,
                    likes: story.likes,
                    created_at: story.created_at,
                    updated_at: story.updated_at
                };
            });
            res.json(storys);
            } else {
                 return res.json([]);
            }
        }
    });
});

app.get('/likes/num/:userId', (req,res) => {
    const userId = req.params.userId;
    const page = parseInt(req.query.page) || 1;
    const size = parseInt(req.query.size) || 20;
    const offset = (page - 1) * size;
    
    const query = 'select e.story_id, count(*) as num, max(case when e.user_id = ? then true else false end) as me from likes e join (select c.* from story c join (select a.id from users a join (select if(created_by = ?, friend_id, created_by) as friend_id from chatroom where created_by = ? or friend_id = ?) b on a.id = b.friend_id or a.id = ? group by a.id union select id from users where id = ?) d on c.user_id = d.id order by c.created_at desc limit ? offset ?) f on e.story_id = f.id group by e.story_id order by f.created_at desc;'
    
    db.query(query, [userId, userId, userId, userId, userId, userId, size, offset], (err, results) => {
        if(err) {
            console.error('Failed to fetch friends:', err);
            res.status(500).send('Server error');
        } else {
            res.json(results);
        }
    });
});

app.get('/likes/:userId', (req,res) => {
    const userId = req.params.userId;
    
    const query = 'select * from likes where ?;'
    db.query(query, [userId], (err, results) => {
        if(err) {
            console.error('Failed to fetch friends:', err);
            res.status(500).send('Server error');
        } else {
            res.json(results);
        }
    });
});

app.get('/images/:userId', (req,res) => {
    const userId = req.params.userId;
    const page = parseInt(req.query.page) || 1;
    const size = parseInt(req.query.size) || 20;
    const offset = (page - 1) * size;
    
    const query = 'select * from images e join (select c.* from story c join (select a.id from users a join (select if(created_by = ?, friend_id, created_by) as friend_id from chatroom where created_by = ? or friend_id = ?) b on a.id = b.friend_id group by a.id union select id from users where id = ?) d on c.user_id = d.id order by c.created_at desc limit ? offset ?) f on e.id = f.id order by f.created_at desc;'
    
    db.query(query, [userId, userId, userId, userId, size, offset], (err, results) => {
        if(err) {
            console.error('Failed to fetch friends:', err);
            res.status(500).send('Server error');
        } else {
            if(results.length > 0) {
             const images = results.map(image => {
               return {
                    id: image.id,
                    image: image.image ? image.image.toString() : null
                };
            });
            res.json(images);
            } else {
                 return res.json([]);
            }
        }
    });
});

app.get('/comments/:storyId', (req,res) => {
    const storyId = req.params.storyId;
    
    const query = 'with recursive CommentTree as ( select id, answer_id, id as root_id from comments where answer_id = 0 union select c.id, c.answer_id, ct.root_id from comments c join CommentTree ct on c.answer_id = ct.id) select count(*) as count ,e.* from CommentTree d join (select a.*, b.name, b.profile_img from comments a join (select id, name, profile_img from users) b on a.user_id = b.id) e on d.root_id = e.id  where e.story_id = ? group by root_id;'
    
    db.query(query, [storyId], (err, results) => {
        if(err) {
            console.error('Failed to fetch friends:', err);
            res.status(500).send('Server error');
        } else {
            if(results.length > 0) {
             const comments = results.map(comment => {
               return {
                    id: comment.id,
                    story_id: comment.story_id,
                    answer_id: comment.answer_id,
                    user_id: comment.user_id,
                    count: comment.count,
                    comment: comment.comment,
                    created_at: comment.created_at,
                    name: comment.name,
                    profile_img: comment.profile_img ? comment.profile_img.toString() : null
                };
            });
            res.json(comments);
            } else {
                 return res.json(null);
            }
        }
    });
});

app.get('/comments/addition/:storyId', (req,res) => {
    const storyId = req.params.storyId;
    const id = parseInt(req.query.id);
    
    const query = 'with recursive CommentTree as (select id, answer_id from comments where answer_id = 0 and id = ? union select c.id, c.answer_id from comments c join CommentTree ct on c.answer_id = ct.id) select g.name as answer_name ,e.* from CommentTree d join (select a.*, b.name, b.profile_img from comments a join (select id, name, profile_img from users) b on a.user_id = b.id) e on d.id = e.id join comments f on d.answer_id = f.id join users g on f.user_id = g.id where e.story_id = ? and d.id != ? and g.id = (select user_id from comments where id = d.answer_id) order by e.created_at;'
    
    db.query(query, [id, storyId, id], (err, results) => {
        if(err) {
            console.error('Failed to fetch friends:', err);
            res.status(500).send('Server error');
        } else {
            if(results.length > 0) {
             const comments = results.map(comment => {
               return {
                    id: comment.id,
                    story_id: comment.story_id,
                    answer_id: comment.answer_id,
                    answer_name: comment.answer_name,
                    user_id: comment.user_id,
                    count: comment.count,
                    comment: comment.comment,
                    created_at: comment.created_at,
                    name: comment.name,
                    profile_img: comment.profile_img ? comment.profile_img.toString() : null
                };
            });
            res.json(comments);
            } else {
                 return res.json(null);
            }
        }
    });
});

app.get('/messages/message/:roomId', (req,res) => {
    const roomId = req.params.roomId;
    const FileType = { image: 'image', video: 'video', text: 'text'};
    
    const query = 'select a.*, b.name from message a join users b on a.sender_id = b.id where a.room_id = ? order by a.created_at ASC';
    db.query(query, [roomId], (err, results) => {
        if(err) {
            console.error('Failed to fetch messages:',err);
            res.status(500).send('Server error');
        } else {
            if(results.length > 0) {
                const messages = results.map(message => {
                    return {
                        room_id: message.room_id,
                        title: message.title,
                        sender_id: message.sender_id,
                        name: message.name,
                        type: FileType[message.file_type],
                        message_text: message.message_text,
                        created_at: message.created_at,          
                    };
                });
                res.json(messages);
            } else {
                 return res.status(204).send();
            }
        }
    });
});

app.get('/rooms/:userId', (req,res) => {
    const userId = req.params.userId;
    const FileType = { image: 'image', video: 'video', text: 'text'};
    
    const query = 'select d.room_id, d.room_name, d.message_text, d.file_type, d.created_at, d.g_check from users c join (select a.room_id, a.room_name, if(a.created_by = ?, a.friend_id, a.created_by) as user_id, a.g_check, b.file_type, b.message_text, b.created_at from chatroom a join (select * from message where (room_id, created_at) in(select room_id, max(created_at) from message group by room_id)) b on a.room_id = b.room_id where ? in (a.created_by,a.friend_id)) d on c.id = d.user_id';
    
    db.query(query, [userId, userId], (err, results) => {
        if(err) {
            console.error('Failed to fetch messages:', err);
            res.status(500).send('Server error');
        } else {
            if(results.length > 0) {
             const rooms = results.map(room => {
               return {
                    room_id: room.room_id,
                    room_name: room.room_name,
                    type: FileType[room.file_type],
                    message_text: room.message_text,
                    created_at: room.created_at,
                    g_check: room.g_check
                };
            });
            res.json(rooms);
            } else {
                 return res.status(204).send();
            }
        }
    });
});

app.get('/grouprooms/:userId', (req,res) => {
    const userId = req.params.userId;
    const FileType = { image: 'image', video: 'video', text: 'text'};
    
    const query = 'select * from chatroom c join (select a.room_id from chatroom a join (select * from userchatroom where user_id = ?) b on a.room_id = b.room_id where g_check = 1) d on c.room_id = d.room_id join (select * from message where (room_id, created_at) in (select room_id, max(created_at) from message group by room_id)) f on d.room_id = f.room_id';
    db.query(query, [userId], (err, results) => {
        if(err) {
            console.error('Failed to fetch messages:', err);
            res.status(500).send('Server error');
        } else {
            if(results.length > 0) {
             const rooms = results.map(room => {
               return {
                    room_id: room.room_id,
                    room_name: room.room_name,
                    type: FileType[room.file_type],
                    message_text: room.message_text,
                    created_at: room.created_at,
                    g_check: room.g_check
                };
            });
            res.json(rooms);
            } else {
                 return res.status(204).send();
            }
        }
    });
});

app.get('/users/blocked/:userId', (req,res) => {
    const userId = req.params.userId;
    const query = 'select * from userblocked where user_id = ?';
    db.query(query, [userId], (err, results) => {
        if(err) {
            console.error('Failed to fetch messages:', err);
            res.status(500).send('Server error');
        } else {
            res.json(results);
        }
    });
});

app.get('/members/:roomId', (req,res) => {
    const roomId = req.params.roomId;
    
    const query = 'select a.id, a.name, a.profile_img from users a join(select * from userchatroom where room_id = ?) b on a.id = b.user_id';
    db.query(query, [roomId], (err, results) => {
        if(err) {
            console.error('Failed to fetch messages:', err);
            res.status(500).send('Server error');
        } else {
            if(results.length > 0) {
             const rooms = results.map(room => {
               return {
                    id: room.id,
                    name: room.name,
                    profile_img: room.profile_img ? room.profile_img.toString() : null
                };
            });
            res.json(rooms);
            } else {
                 return res.status(204).send();
            }
        }
    });
});

app.get('/messages/chatroom/:userId', (req,res) => {
    const userId = req.params.userId;  
    const query = 'select created_by as user_id, room_id, friend_id from chatroom where created_by = ? or friend_id = ?';
    db.query(query, [userId, userId], (err, results) => {
        if(err) {
            console.error('Failed to fetch messages:', err);
            res.status(500).send('Server error');
        } else {
            res.json(results);
        }
    });
});

app.put('/revise/profile/:userId', (req,res) => {
    const userId = req.params.userId;
    const {name, message, image} = req.body;
    
    const query = 'update users set name = ?, message = ?, profile_img = ? where id = ?';
    db.query(query, [name, message, image, userId], (err, results) => {
        if(err) {
            console.error('Failed to fetch messages:', err);
            res.status(500).send('Server error');
        } else {
            res.json(results);
        }
    });
});

wss.on('connection', ws => {
	console.log('Client connected');

	
	ws.on('message', message => {
	    const parse = JSON.parse(message);
	    const roomId = parse.room_id;
	    const senderId = parse.sender_id;
	    const text = parse.message_text;
	    const title = parse.title || "null";
	    const name = parse.name;
	    const type = parse.type;
    
	    
	    const storyId = parse.story_id;
	    const answerId = parse.answer_id;
	    const comment = parse.comment;
	    const userId = parse.user_id;
	    
	    if(!roomId) {
	        commentNotification(storyId, userId, name, answerId, comment);
	    } else {
	        sendNotification(roomId, title, name, text, type);
	    }
	    
	    if(!rooms[roomId]){
	        rooms[roomId] =[];
	    }
	
	    if(!rooms[roomId].includes(ws)) {
	        rooms[roomId].push(ws);
	    }
	    
	     wss.clients.forEach(client => {
			if (client.readyState === WebSocket.OPEN) {
			   client.send(JSON.stringify(JSON.parse(message)));
			   console.log(`message: => ${message}`); 
		    }
	    });
	});
	
	
	ws.on('close', () => {
		console.log('Client disconnected');
	});
});  

server.listen(8081, '0.0.0.0', () => {
	console.log('Server is listening on port 8081');
});

async function sendNotification(roomId, title, name, body, type) {  // 메시지 알림 처리
    const query = `select a.token from usertoken a join (select user_id from userchatroom where room_id = ? union select created_by as user_id from chatroom where room_id = ? union select friend_id as user_id from chatroom where room_id = ?) b on a.user_id = b.user_id`;

    db.query(query, [roomId, roomId, roomId], async (err, results) => {
        if (err) {
            console.error("Failed to fetch tokens:", err);
            return;
        }
        const tokens = results.map(result => result.token);
        if (tokens.length === 0) {
            console.log(`No tokens found for room_id: ${roomId}`);
            return;
        }
        let nTitle = title;
        let nBody = name + ": " + body;
        if(type === "image") {
            nBody = name + ": 이미지를 보냈습니다.";
        } else if(type === "video") {
            nBody = name + ": 동영상를 보냈습니다.";
        }
        if(title === name) { nTitle = "" };
        const chunkSize = 500;
        try {
            for (let i = 0; i < tokens.length; i += chunkSize) {
                const tokenChunk = tokens.slice(i, i + chunkSize);
                for (const token of tokens) {
                    try {
                        const response = await admin.messaging().send({
                            token: token,
                            notification: {
		                        title: title,
			                    body: nBody,
		                    },
		                    data: {
		                        title: nTitle,
			                    body: nBody,
		                        name: name.toString(),
		                        room: roomId.toString(),
		                    },
		                    android: {
		                        notification: {
		                            click_action: "OPEN_CHAT_ACTIVITY"
		                        }
		                    },
		                });
                    } catch (error) {
                        console.error(`Failed to send notification to ${token}:`, error); 
                    }
                }
            }
        } catch (error) {
            console.error("Error sending notifications:", error);
        }
    });
}

async function commentNotification(storyId, userId, name, answerId, comment) {  // 댓글 알림 처리
    const query = `select distinct a.token from usertoken a join (select user_id from story where id = ? union select user_id from comments where story_id = ? and id = ?) b on a.user_id = b.user_id`;

    db.query(query, [storyId, storyId, answerId], async (err, results) => {
        if (err) {
            console.error("Failed to fetch tokens:", err);
            return;
        }
       
        const tokens = results.map(result => result.token);

        if (tokens.length === 0) {
            console.log(`No tokens found for storyId: ${storyId}`);
            return;
        }
        let nTitle = name + "님께서 답글을 남겼습니다.";
        const chunkSize = 500;
        try {
            for (let i = 0; i < tokens.length; i += chunkSize) {
                const tokenChunk = tokens.slice(i, i + chunkSize);
                for (const token of tokens) {
                    try {
                        const response = await admin.messaging().send({
                            token: token,
                            notification: {
		                        title: nTitle,
			                    body: comment,
			                    
		                    },
		                    data: {
		                        title: nTitle,
			                    body: comment,
			                    story: storyId.toString(),
			                    name: name,
			                    room: '0'.toString(),
			                    userId: userId.toString(),
		                    },
		                    android: {
		                        notification: {
		                            click_action: "OPEN_COMMENT_ACTIVITY"
		                        }
		                    },
		                });
                    } catch (error) {
                        console.error(`Failed to send notification to ${token}:`, error); 
                    }
                }
            }
        } catch (error) {
            console.error("Error sending notifications:", error);
        }
    });
}	        
