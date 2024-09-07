const express = require("express");
const router = express.Router();

// ℹ️ Handles files upload
const fileUploader = require("../config/cloudinary.config.js");

// Require the User model in order to interact with the database
const User = require("../models/User.model");

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

router.post("/profile", fileUploader.single("profilePic"), async (req, res, next) => {
    const { email, name, gender, birthdate, country } = req.body;
    const profilePic = req.file ? req.file.path : null
  
    // Check if email or password or name are provided as empty strings
    if (email === "" || name === "") {
      res.status(400).json({ message: "Provide email and name" });
      return;
    }
  
    // This regular expression check that the email is of a valid format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ message: "Provide a valid email address." });
      return;
    }
  
    try {
      await User.findByIdAndUpdate({ email, name, gender, birthdate, country, profilePic });
      const updatedUser = { email, name, profilePic, _id: createdUser._id };
      res.status(201).json({ user: updatedUser });
    } catch (err) {
      next(err); // In this case, we send error handling to the error handling middleware.
    }
});

module.exports = router;