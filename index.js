const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const dotenv = require("dotenv");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 5000;

dotenv.config();

const app = express();

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://buddy-script-client-seven.vercel.app",
  ],
  credentials: true,
  optionSuccessStatus: 200,
};

// middleware
app.use(express.json());
app.use(cors(corsOptions));
app.use(cookieParser());

const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("buddy-script");

    const usersCollection = db.collection("users");
    const postsCollection = db.collection("posts");

    // verification
    const verifyToken = async (req, res, next) => {
      const token = req.cookies?.token;

      if (!token) {
        return res
          .status(401)
          .send({ message: "token not found unauthorized access" });
      }
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          console.log(err);
          return res
            .status(401)
            .send({ message: "invalid token unauthorized access" });
        }
        req.user = decoded;
        next();
      });
    };

    // create token
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(
        user,
        process.env.ACCESS_TOKEN_SECRET || "secretkey",
        {
          expiresIn: "1d",
        },
      );

      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // Logout Route
    app.post("/logout", async (req, res) => {
      res
        .clearCookie("token", {
          maxAge: 0,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // add user
    app.post("/add-user", async (req, res) => {
      try {
        const data = req.body;

        const isExist = await usersCollection.findOne({ email: data.email });

        if (!isExist) {
          const result = await usersCollection.insertOne({
            ...data,
            joinedAt: new Date(),
          });
          res.send(result);
        } else {
          return res.send(isExist);
        }
      } catch (error) {
        console.error("Upsert Error:", error);
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // create post
    app.post("/crate-post", verifyToken, async (req, res) => {
      try {
        const data = req.body;
        const result = await postsCollection.insertOne({
          ...data,
          time: new Date(),
        });
        res.send(result);
      } catch (error) {
        console.error("Upsert Error:", error);
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // Get all posts
    app.get("/posts", verifyToken, async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 0;
        const size = parseInt(req.query.size) || 5;

        const posts = await postsCollection
          .find()
          .sort({ time: -1 })
          .skip(page * size)
          .limit(size)
          .toArray();

        res.json(posts);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Post like/unlike
    app.patch("/posts/:postId/like", verifyToken, async (req, res) => {
      try {
        const { postId } = req.params;
        const { userId, userName, userEmail, userImage } = req.body;
        const filter = { _id: new ObjectId(postId) };

        const post = await postsCollection.findOne(filter);

        if (!post) {
          return res.status(404).json({ message: "Post not found" });
        }

        const currentLikes = post.likes || [];

        const likeIndex = currentLikes.findIndex(
          (like) => String(like.userId) === String(userId),
        );

        let updateDoc;
        if (likeIndex === -1) {
          updateDoc = {
            $push: { likes: { userId, userName, userEmail, userImage } },
          };
        } else {
          updateDoc = {
            $pull: { likes: { userId: userId } },
          };
        }

        const result = await postsCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
      }
    });

    // Add comment
    app.post("/posts/:postId/comment", verifyToken, async (req, res) => {
      try {
        const { postId } = req.params;
        const { userId, userName, userEmail, userImage, text } = req.body;

        const filter = { _id: new ObjectId(postId) };

        const newComment = {
          commentId: new ObjectId(),
          userId,
          userName,
          userEmail,
          userImage,
          text,
          likes: [],
          replies: [],
          time: new Date(),
        };

        const result = await postsCollection.updateOne(filter, {
          $push: { comments: newComment },
        });

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Post not found" });
        }

        res
          .status(201)
          .json({ message: "Comment added successfully", comment: newComment });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Like/Unlike comment
    app.post(
      "/posts/:postId/comment/:commentId/like",
      verifyToken,
      async (req, res) => {
        try {
          const { postId, commentId } = req.params;
          const { userId, userName, userEmail, userImage } = req.body;

          const filter = { _id: new ObjectId(postId) };

          const post = await postsCollection.findOne(filter);

          if (!post) {
            return res.status(404).json({ message: "Post not found" });
          }

          const comment = post.comments?.find(
            (c) =>
              c.commentId.toString() === commentId || c.commentId === commentId,
          );

          if (!comment) {
            return res.status(404).json({ message: "Comment not found" });
          }

          const alreadyLiked = comment.likes?.some(
            (like) => like.userId === userId,
          );

          let updateDoc;
          if (!alreadyLiked) {
            updateDoc = {
              $push: {
                "comments.$[commentFilter].likes": {
                  userId,
                  userName,
                  userEmail,
                  userImage,
                },
              },
            };
          } else {
            updateDoc = {
              $pull: { "comments.$[commentFilter].likes": { userId: userId } },
            };
          }

          const options = {
            arrayFilters: [
              { "commentFilter.commentId": new ObjectId(commentId) },
            ],
          };

          const result = await postsCollection.updateOne(
            filter,
            updateDoc,
            options,
          );

          if (result.modifiedCount > 0) {
            res.status(200).json({ message: "Success", result });
          } else {
            res.status(400).json({ message: "No changes made" });
          }
        } catch (error) {
          console.error("Error in comment like:", error);
          res.status(500).json({ error: error.message });
        }
      },
    );

    // Add reply to a specific comment
    app.post(
      "/posts/:postId/comment/:commentId/reply",
      verifyToken,
      async (req, res) => {
        try {
          const { postId, commentId } = req.params;
          const { userId, userName, userEmail, userImage, text } = req.body;

          const filter = { _id: new ObjectId(postId) };

          const newReply = {
            replyId: new ObjectId(),
            userId,
            userName,
            userEmail,
            userImage,
            text,
            likes: [],
            time: new Date(),
          };

          const updateDoc = {
            $push: { "comments.$[commentFilter].replies": newReply },
          };

          const options = {
            arrayFilters: [
              { "commentFilter.commentId": new ObjectId(commentId) },
            ],
          };

          const result = await postsCollection.updateOne(
            filter,
            updateDoc,
            options,
          );

          if (result.matchedCount === 0) {
            return res
              .status(404)
              .json({ message: "Post or Comment not found" });
          }

          res
            .status(201)
            .json({ message: "Reply added successfully", reply: newReply });
        } catch (error) {
          console.error("Error in reply:", error);
          res.status(500).json({ error: error.message });
        }
      },
    );

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// route
app.get("/", (req, res) => {
  res.send("Hello Express Server");
});

// server start
app.listen(port, () => {
  console.log(`Server running on port:${port}`);
});
