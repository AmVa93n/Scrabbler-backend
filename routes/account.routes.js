const express = require("express");
const router = express.Router();

// ℹ️ Handles files upload
const fileUploader = require("../config/cloudinary.config.js");

// Require the User model in order to interact with the database
const User = require("../models/User.model");
const Room = require("../models/Room.model");
const Board = require("../models/Board.model");
const TileBag = require("../models/TileBag.model.js");

// Require necessary (isAuthenticated) middleware in order to control access to specific routes
const { isAuthenticated } = require("../middleware/jwt.middleware.js");

router.get("/profile", isAuthenticated, async (req, res, next) => {
    try {
        // Find user by their _id (from the JWT payload)
        const userData = await User.findById(req.payload._id);
        
        if (!userData) {
          return res.status(404).json({ message: "User not found" });
        }
        res.status(200).json({ user: userData });
      } catch (error) {
        next(error); // Pass any errors to the error handling middleware
      }
});

router.put("/profile", isAuthenticated, fileUploader.single("profilePic"), async (req, res, next) => {
    const { email, name, gender, birthdate, country } = req.body;
    const profilePic = req.file ? req.file.path : null

    // Create an object with only the fields that are present in the request
    const updateFields = {};
    if (email !== undefined) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
      if (!emailRegex.test(email)) {
        res.status(400).json({ message: "Provide a valid email address." });
        return;
      }
      updateFields.email = email
    };
    if (name !== undefined) {
      if (name === "") {
        res.status(400).json({ message: "Provide a valid name." });
        return;
      }
      updateFields.name = name
    };
    if (gender) updateFields.gender = gender;
    if (birthdate) updateFields.birthdate = birthdate;
    if (country) updateFields.country = country;
    if (profilePic) updateFields.profilePic = profilePic;
  
    try {
    // Update the user with only the provided fields
      const updatedUser = await User.findByIdAndUpdate(req.payload._id, updateFields, { new: true });
      res.status(201).json({ user: updatedUser });
    } catch (err) {
      next(err); // In this case, we send error handling to the error handling middleware.
    }
});

router.delete("/profile", isAuthenticated, async (req, res, next) => {
    try {
        // Find user by their _id (from the JWT payload) and delete it
        await User.findByIdAndDelete(req.payload._id)
        res.status(200).send()

      } catch (error) {
        next(error); // Pass any errors to the error handling middleware
      }
});

// room routes

router.get("/rooms", isAuthenticated, async (req, res, next) => {
  try {
    const roomsData = await Room.find({creator: req.payload._id});
    
    if (!roomsData) {
      return res.status(404).json({ message: "Rooms not found" });
    }

    res.status(200).json({ rooms: roomsData });
  } catch (err) {
    next(err);
  }
});

router.get("/room/:roomId", isAuthenticated, async (req, res, next) => {
  try {
    const roomId = req.params.roomId;
    const roomData = await Room.findById(roomId)
      .populate('gameSession')
      .populate({
        path: 'messages',
        populate: [
          {
            path: 'sender',
            select: 'name profilePic',
          },
          {
            path: 'reactions',  // Populate 'reactions' array
            populate: {
              path: 'user',      // Populate the 'user' field within each 'reaction'
              select: 'name',    // Select only the 'name' field from the 'user'
            }
          }
        ]
      });
      
    if (!roomData) {
      return res.status(404).json({ message: "Room not found" });
    }
    
    res.status(200).json({ room: roomData });
  } catch (err) {
    next(err);  // Pass the error to the error-handling middleware
  }
});

router.post("/room", isAuthenticated, fileUploader.single("roomImage"), async (req, res, next) => {
  try {
    const creator = req.payload._id;
    const { name, description } = req.body;
    const image = req.file ? req.file.path : null
    
    const createdRoom = await Room.create({ creator, name, description, image, gameSession: null, kickedUsers: []})
    res.status(200).json({ room: createdRoom });
  } catch (err) {
    next(err);  // Pass the error to the error-handling middleware
  }
});

router.put("/room/:roomId", isAuthenticated, fileUploader.single("roomImage"), async (req, res, next) => {
  try {
    const roomId = req.params.roomId;
    const { name, description, gameSession, kickedUsers } = req.body;
    const image = req.file ? req.file.path : undefined

    const updatedRoom = await Room.findByIdAndUpdate(roomId, { name, description, image, gameSession, kickedUsers }, { new: true })
    .populate('gameSession.players')
    .populate({
      path: 'messages',
      populate: {
        path: 'sender',
        select: 'name profilePic',
      }
    });

    if (!updatedRoom) {
      return res.status(404).json({ message: "Room not found" });
    }

    res.status(200).json({ room: updatedRoom });
  } catch (err) {
    next(err);  // Pass the error to the error-handling middleware
  }
});

router.delete("/room/:roomId", isAuthenticated, async (req, res, next) => {
  try {
    const roomId = req.params.roomId;
    const deletedRoom = await Room.findByIdAndDelete(roomId);
    if (!deletedRoom) {
      return res.status(404).json({ message: "Room not found" });
    }
    res.status(200).send()

  } catch (err) {
    next(err);  // Pass the error to the error-handling middleware
  }
});

// board routes

router.get("/boards", isAuthenticated, async (req, res, next) => {
  try {
    const boardsData = await Board.find({$or: [{creator: req.payload._id}, {default: true}]});
    
    if (!boardsData) {
      return res.status(404).json({ message: "Boards not found" });
    }

    res.status(200).json({ boards: boardsData });
  } catch (err) {
    next(err);
  }
});

router.post("/board", isAuthenticated, async (req, res, next) => {
  try {
    const creator = req.payload._id;
    const { name, size, bonusSquares } = req.body;
    
    const createdBoard = await Board.create({ creator, name, size, bonusSquares})
    res.status(200).json({ board: createdBoard });
  } catch (err) {
    next(err);  // Pass the error to the error-handling middleware
  }
});

router.put("/board", isAuthenticated, async (req, res, next) => {
  try {
    const { _id, name, size, bonusSquares } = req.body;

    const updatedBoard = await Board.findByIdAndUpdate(_id, { name, size, bonusSquares }, { new: true })

    if (!updatedBoard) {
      return res.status(404).json({ message: "Board not found" });
    }

    res.status(200).json({ board: updatedBoard });
  } catch (err) {
    next(err);  // Pass the error to the error-handling middleware
  }
});

router.delete("/board/:boardId", isAuthenticated, async (req, res, next) => {
  try {
    const boardId = req.params.boardId;
    const deletedBoard = await Board.findByIdAndDelete(boardId);
    if (!deletedBoard) {
      return res.status(404).json({ message: "Board not found" });
    }
    res.status(200).send()

  } catch (err) {
    next(err);  // Pass the error to the error-handling middleware
  }
});

// tile bag routes

router.get("/tilebags", isAuthenticated, async (req, res, next) => {
  try {
    const tileBagsData = await TileBag.find({$or: [{creator: req.payload._id}, {default: true}]});
    
    if (!tileBagsData) {
      return res.status(404).json({ message: "Tile Bags not found" });
    }
    
    res.status(200).json({ tileBags: tileBagsData });
  } catch (err) {
    next(err);
  }
});

router.post("/tilebag", isAuthenticated, async (req, res, next) => {
  try {
    const creator = req.payload._id;
    const { name, letterData } = req.body;
    
    const createdTileBag = await TileBag.create({ creator, name, letterData})
    res.status(200).json({ tilebag: createdTileBag });
  } catch (err) {
    next(err);  // Pass the error to the error-handling middleware
  }
});

router.put("/tilebag", isAuthenticated, async (req, res, next) => {
  try {
    const { _id, name, letterData } = req.body;

    const updatedTileBag = await TileBag.findByIdAndUpdate(_id, { name, letterData }, { new: true })

    if (!updatedTileBag) {
      return res.status(404).json({ message: "Tile Bag not found" });
    }

    res.status(200).json({ tilebag: updatedTileBag });
  } catch (err) {
    next(err);  // Pass the error to the error-handling middleware
  }
});

router.delete("/tilebag/:tilebagId", isAuthenticated, async (req, res, next) => {
  try {
    const tilebagId = req.params.tilebagId;
    const deletedTileBag = await TileBag.findByIdAndDelete(tilebagId);
    if (!deletedTileBag) {
      return res.status(404).json({ message: "Tile Bag not found" });
    }
    res.status(200).send()

  } catch (err) {
    next(err);  // Pass the error to the error-handling middleware
  }
});

// misc.

router.get("/ping", isAuthenticated, async (req, res, next) => {
  res.status(200).send() // this is just to keep the server from spinning down
});

module.exports = router;