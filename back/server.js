import mongoose from "mongoose";
import jwt from "jsonwebtoken";

const SECRET = process.env.SECRET || "entrelinhas_secret";
const MONGO_URI = process.env.MONGO_URI;

if (!mongoose.connection.readyState) {
  await mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log("MongoDB conectado ✅");
}

/* ================= SCHEMAS ================= */

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  username: { type: String, unique: true },
  password: String,
  grade: String,
  region: String
});

const postSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  username: String,
  content: String,
  anonymous: Boolean,
  hideLikes: Boolean,
  mood: String,
  likes: [mongoose.Schema.Types.ObjectId],
  reports: [mongoose.Schema.Types.ObjectId],
  comments: [{
    userId: mongoose.Schema.Types.ObjectId,
    username: String,
    content: String,
    createdAt: { type: Date, default: Date.now }
  }],
  hidden: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model("User", userSchema);
const Post = mongoose.models.Post || mongoose.model("Post", postSchema);

/* ================= AUTH MIDDLEWARE ================= */

async function auth(req) {
  const header = req.headers.authorization;
  if (!header) throw { status: 401, error: "Token necessário" };

  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  try {
    const decoded = jwt.verify(token, SECRET);
    const user = await User.findById(decoded.id);
    if (!user) throw { status: 401, error: "Usuário não encontrado" };
    return user;
  } catch {
    throw { status: 401, error: "Token inválido" };
  }
}

/* ================= HANDLER ================= */

export default async function handler(req, res) {
  const url = req.url.replace(/^\/api/, "");
  const method = req.method;

  try {
    /* ================= REGISTER ================= */
    if (url === "/auth/register" && method === "POST") {
      const { email, username, password, grade, region } = req.body;
      if (!email || !username || !password || !grade || !region)
        return res.status(400).json({ error: "Preencha todos os campos" });

      try {
        const user = new User({ email, username, password, grade, region });
        await user.save();
        return res.json({ message: "Conta criada" });
      } catch (err) {
        if (err.code === 11000) return res.status(400).json({ error: "Email ou username já cadastrado" });
        else return res.status(500).json({ error: "Erro no servidor" });
      }
    }

    /* ================= LOGIN ================= */
    if (url === "/auth/login" && method === "POST") {
      const { email, password } = req.body;
      const user = await User.findOne({ email, password });
      if (!user) return res.status(400).json({ error: "Credenciais inválidas" });

      const token = jwt.sign({ id: user._id, username: user.username }, SECRET);
      return res.json({ token });
    }

    /* ================= CREATE POST ================= */
    if (url === "/posts" && method === "POST") {
      const user = await auth(req);
      const { content, anonymous, hideLikes, mood } = req.body;

      if (!content || content.length > 500)
        return res.status(400).json({ error: "Conteúdo inválido (máx 500 caracteres)" });

      if (/(http|www|\.com|\.net|\.org)/i.test(content))
        return res.status(400).json({ error: "Links não permitidos" });

      const alreadyPostedToday = await Post.findOne({
        userId: user._id,
        createdAt: { $gte: new Date(new Date().setHours(0,0,0,0)) }
      });
      if (alreadyPostedToday) return res.status(400).json({ error: "Você já postou hoje" });

      const post = new Post({ userId: user._id, username: user.username, content, anonymous, hideLikes, mood });
      await post.save();
      return res.json(post);
    }

    /* ================= GET POSTS ================= */
    if (url === "/posts" && method === "GET") {
      const posts = await Post.find({ hidden: false }).sort({ createdAt: -1 });
      return res.json(posts);
    }

    /* ================= LIKE ================= */
    if (url.match(/^\/posts\/[a-f0-9]{24}\/like$/) && method === "POST") {
      const user = await auth(req);
      const postId = url.split("/")[2];
      const post = await Post.findById(postId);
      if (!post) return res.status(404).json({ error: "Post não encontrado" });

      const liked = post.likes.some(id => id.equals(user._id));
      if (liked) post.likes = post.likes.filter(id => !id.equals(user._id));
      else post.likes.push(user._id);

      await post.save();
      return res.json({ likes: post.likes.length });
    }

    /* ================= COMMENT ================= */
    if (url.match(/^\/posts\/[a-f0-9]{24}\/comment$/) && method === "POST") {
      const user = await auth(req);
      const postId = url.split("/")[2];
      const { content } = req.body;

      if (!content || content.length > 250) return res.status(400).json({ error: "Comentário inválido (máx 250 caracteres)" });
      if (/(http|www|\.com|\.net|\.org)/i.test(content)) return res.status(400).json({ error: "Links não permitidos" });

      const post = await Post.findById(postId);
      if (!post) return res.status(404).json({ error: "Post não encontrado" });

      post.comments.push({ userId: user._id, username: user.username, content });
      await post.save();
      return res.json({ message: "Comentário adicionado" });
    }

    /* ================= DELETE POST ================= */
    if (url.match(/^\/posts\/[a-f0-9]{24}$/) && method === "DELETE") {
      const user = await auth(req);
      const postId = url.split("/")[2];
      const post = await Post.findById(postId);
      if (!post) return res.status(404).json({ error: "Post não encontrado" });
      if (!post.userId.equals(user._id)) return res.status(403).json({ error: "Sem permissão" });

      await Post.deleteOne({ _id: post._id });
      return res.json({ message: "Post apagado" });
    }

    /* ================= REPORT ================= */
    if (url.match(/^\/posts\/[a-f0-9]{24}\/report$/) && method === "POST") {
      const user = await auth(req);
      const postId = url.split("/")[2];
      const post = await Post.findById(postId);
      if (!post) return res.status(404).json({ error: "Post não encontrado" });

      if (post.reports.includes(user._id)) return res.status(400).json({ error: "Você já denunciou" });
      post.reports.push(user._id);
      if (post.reports.length >= 10) post.hidden = true;

      await post.save();
      return res.json({ reports: post.reports.length });
    }

    /* ================= HISTORY ================= */
    if (url === "/me/history" && method === "GET") {
      const user = await auth(req);

      const myPosts = await Post.find({ userId: user._id });
      const myComments = [];

      const allPosts = await Post.find();
      allPosts.forEach(p => {
        p.comments.forEach(c => {
          if (c.userId.equals(user._id)) myComments.push({ postId: p._id, ...c.toObject() });
        });
      });

      return res.json({ posts: myPosts, comments: myComments });
    }

    return res.status(404).json({ error: "Rota não encontrada" });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.error || "Erro interno" });
  }
}
