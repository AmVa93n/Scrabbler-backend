# Scrabbler

<br>

## Description

This is an app that was developed as the third and final project of Ironhack's Web Development Bootcamp. It is a full-stack application using the MERN stack (MongoDB, Express, React and Node.js) that is dedicated to fans of the popular board game Scrabble. The app allows users to play Scrabble online (based on the English version of the game), create and manage private rooms with live messaging, customize game rules, create their own board layouts and tile bag configuations, and keep record of their entire game history. The app also connects to a GPT completion model that can be used during games to generate text based on the words that players create.

## User Stories

-  **404:** As an anon/user I can see a 404 page if I try to reach a page that does not exist so that I know it's my fault
-  **Dictionary:** As an anon/user I can see the full list of valid words in Scrabble and search for words
-  **Rules:** As an anon/user I can see the rules of how to play Scrabble
-  **Signup:** As an anon I can sign up in the platform so that I can start playing
-  **Login:** As a user I can login to the platform so that I can start playing
-  **Logout:** As a user I can logout from the platform so no one else can modify my information
-  **Profile:** As a user I can edit my profile information
-  **Rooms:** As a user I can create, edit and delete rooms where I can play with whomever I choose to share the room link
-  **Game History:** As a user I can view details about all past games I've participated in
-  **Board Editor:** As a user I can create new boards with custom layouts of bonus squares
-  **Tile Bag Editor:** As a user I can create new tile bags with custom letter distribution and scores

## Backlog

- Dictionary search bar
- Managing room banlist
- Sharing created content
- Public rooms
- Dictionary Customization

<br>

# Client / Frontend

## React Router Routes (React App)
| Path             | Component          | Permissions              | Behavior                                                      |
| ---------------- | -------------------| ------------------------ | ------------------------------------------------------------- |
| `/`              | HomePage           | public `<Route>`         | Home page                                    |
| `/dictionary`    | DictionaryPage     | public `<Route>`         | Shows all valid words in Scrabble            |
| `/rules`         | RulesPage          | public `<Route>`         | Explains how to play Scrabble                |
| `/signup`        | SignUpPage         | anon only `<IsAnon>`     | Signup form, link to login, navigate to homepage after signup |
| `/login`         | SignInPage         | anon only `<IsAnon>`     | Login form, link to signup, navigate to homepage after login  |
| `/profile`       | ProfilePage        | user only `<IsPrivate>`  | Shows profile info and allows editing           |
| `/rooms`         | RoomsPage          | user only `<IsPrivate>`  | Shows all user rooms and allow creating new rooms, editing and deleting |
| `/games`         | GameHistoryPage    | user only `<IsPrivate>`  | Shows data about all past games the user participated in |
| `/boardeditor`   | BoardEditorPage    | user only `<IsPrivate>`  | Allows creating, editing and deleting custom board layouts |
| `/tilebageditor` | TileBagEditorPage  | user only `<IsPrivate>`  | Allows creating, editing and deleting custom tile bags |
| `/rooms/:roomId` | RoomPage           | user only `<IsPrivate>`  | A private page where the Scrabble games take place |

## Components

- CallToAction
- CountrySelect
- FeaturesSection
- GoogleAuth
- HeroSection
- IsAnon
- IsPrivate
- NavBar
- NumberInput
- SearchBar
- Loading

- ChatInput
- CreateRoom
- EditRoom
- Reactions
- RoomBar
- RoomChat
- RulesModal
- UserList

- GameActions
- GameSettings
- AlertModal
- BlankModal
- InactiveModal
- PromptModal
- SwapModal
- Board
- Square
- Rack
- Tile
- Timer

## Services

- Auth Service
  - .login(requestBody)
  - .signup(requestBody)
  - .verify()
  - .google(requestBody)

- Account Service
  - .getProfile()
  - .updateProfile(requestBody)
  - .deleteAccount()
  - .getRooms()
  - .getRoom(roomId)
  - .createRoom(requestBody)
  - .updateRoom(roomId, requestBody)
  - .deleteRoom(roomId)
  - .getBoards()
  - .createBoard(requestBody)
  - .updateBoard(requestBody)
  - .deleteBoard(boardId)
  - .getTileBags()
  - .createTileBag(requestBody)
  - .updateTileBag(requestBody)
  - .deleteTileBag(tilebagId)
  - .getGames()

- App Service
  - .ping()
  - .getDictionary()

<br>

# Server / Backend

## Models

User model

```javascript
{
    email: { type: String, required: [true, "Email is required."], unique: true, lowercase: true, trim: true },
    password: { type: String },
    name: { type: String, required: [true, "Name is required."] },
    gender: { type: String },
    birthdate: { type: String },
    country: { type: String },
    profilePic: { type: String },
    googleId: { type: String },
}
```

Room model

```javascript
 {
    creator: { type: Schema.Types.ObjectId, ref: 'User'},
    name: { type: String, required: true },
    description: { type: String },
    image: { type: String },
    gameSession: { type: Schema.Types.ObjectId, ref: 'Game' },
    messages: [{ type: Schema.Types.ObjectId, ref: 'Message' }],
    kickedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
 }
```

Game model

```javascript
 {
    room: { type: Schema.Types.ObjectId, ref: 'Room'},
    host: { type: Schema.Types.ObjectId, ref: 'User'},
    players: [{ 
        _id: String, 
        name: String, 
        profilePic: String,
        rack: [{
            id: { type: Number },
            letter: { type: String },
            points: { type: Number },
            isBlank: { type: Boolean },
        }],
        score: Number,
        inactiveTurns: Number,
        reactionScore: Number,
    }],
    settings: {
        board: { type: Schema.Types.ObjectId, ref: 'Board'},
        tileBag: { type: Schema.Types.ObjectId, ref: 'TileBag'},
        turnDuration: { type: Number },
        turnsUntilSkip: { type: Number },
        rackSize: { type: Number },
        gameEnd: { type: String },
    },
    state: {
        turnPlayerIndex: { type: Number },
        turnEndTime: { type: Date },
        turnNumber: { type: Number },
        board: [[{ 
            x: Number,
            y: Number,
            occupied: Boolean,
            content: {
                id: { type: Number },
                letter: { type: String },
                points: { type: Number },
                isBlank: { type: Boolean },
            },
            bonusType: String,
            fixed: Boolean,
        }]],
        leftInBag: { type: Number },
        passedTurns: { type: Number },
        isOnCooldown: { type: Boolean },
    },
 }
```

Board model

```javascript
 {
    creator: { type: Schema.Types.ObjectId, ref: 'User'},
    name: { type: String, required: true },
    size: { type: Number, default: 15 },
    bonusSquares: [{ x: Number, y: Number, bonusType: String }],
    default: { type: Boolean }
 }
```

TileBag model

```javascript
 {
    creator: { type: Schema.Types.ObjectId, ref: 'User'},
    name: { type: String, required: true },
    letterData: [{ letter: String, count: Number, points: Number }],
    default: { type: Boolean }
 }
```

Message model

```javascript
 {
    sender: { type: Schema.Types.ObjectId, ref: 'User' },
    recipient: { type: Schema.Types.ObjectId, ref: 'User' },
    text: { type: String },
    timestamp: { type: Date, default: Date.now },
    title: { type: String },
    minor: { type: Boolean },
    generated: { type: Boolean },
    generatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    generatedFor: { type: Schema.Types.ObjectId, ref: 'Game' },
    targetReaction: { type: String },
    reactions: [{
        user: { type: Schema.Types.ObjectId, ref: 'User' },
        type: { type: String },
    }]
 }
```

<br>


## API Endpoints (backend routes)

| HTTP Method | URL                 | Request Body                 | Success status | Error Status | Description              |
| ----------- | ------------------- | ---------------------------- | -------------- | ------------ | ------------------------ |
| POST        | `/auth/signup`      | {email, password, name, gender, birthdate, country} | 201 | 400 | Checks that all necessary fields are present and valid, checks if a user already exists, if the user is new - creates new user in the database with hashed password and sends info back to the client |
| POST        | `/auth/login`       | {email, password} | 200 | 400, 401 | Checks that all fields are present, checks if a user exists with the email, checks if the password matches the existing user. if the password is correct, creates a JSON web token, signs it, and send it back to the client |
| GET         | `/auth/verify`      | | 200 | | Checks if JWT token is valid, the payload gets decoded by the middleware and is made available on `req.payload`. Sends back the token payload object containing the user data |
| POST        | `/auth/google`      | {idToken} | 200 | 400, 401 | Verifies the GoogleAuth token, checks if a user with the same email already exists, check if the user already signed up with google, if the user is new - creates new user in the database, creates a JSON web token, signs it, and send it back to the client |
| GET         | `/account/profile`  | | 200 | 404 | Finds user by their id (from the JWT payload) and if it exists, sends it back to the client |
| PUT         | `/account/profile`  | {email, name, gender, birthdate, country} | 201 | 400 | Creates an object with only the fields that are present in the request, checks that necessary fields are valid, updates the user in the database and sends the updated user back to the client |
| DELETE      | `/account/profile`  | | 200 | | Finds user by their id (from the JWT payload) and if it exists, deletes it |
| GET         | `/account/games`    | | 200 | | Finds all games that the user participated in (by user id from the JWT payload) and sends them to the client |
| GET         | `/account/rooms`              | | 200 | 404 | Finds all rooms that the user created (by user id from the JWT payload) and sends them to the client |
| GET         | `/account/room/:roomId`       | | 200 | 404 | Finds room by id (from request params) and if it exists, sends it to the client |
| POST        | `/account/room`               | {name, description} | 200 | | Creates new room in the database |
| PUT         | `/account/room/:roomId`       | {name, description} | 200 | 404 | Finds room by id (from request params) and if it exists, updates it in the database and sends the updated room to the client |
| DELETE      | `/account/room/:roomId`       | | 200 | 404 | Finds room by id (from request params) and if it exists, deletes it |
| GET         | `/account/boards`             | | 200 | 404 | Finds all boards that the user created (by user id from the JWT payload) plus default boards and sends them to the client |
| POST        | `/account/board`              | {name, size, bonusSquares} | 200 | | Creates new board in the database |
| PUT         | `/account/board`              | {_id, name, size, bonusSquares} | 200 | 404 | Finds board by id (from request body) and if it exists, updates it in the database and sends the updated board to the client |
| DELETE      | `/account/board/:boardId`     | | 200 | 404 | Finds board by id (from request params) and if it exists, deletes it |
| GET         | `/account/tilebags`           | | 200 | 404 | Finds all tile bags that the user created (by user id from the JWT payload) plus default tile bags and sends them to the client |
| POST        | `/account/tilebag`            | {name, letterData} | 200 | | Creates new tile bag in the database |
| PUT         | `/account/tilebag`            | {_id, name, letterData} | 200 | 404 | Finds tile bag by id (from request body) and if it exists, updates it in the database and sends the updated tile bag to the client |
| DELETE      | `/account/tilebag/:tilebagId` | | 200 | 404 | Finds tile bag by id (from request params) and if it exists, deletes it |
| GET         | `/api/ping`                   | | 200 | | This route is only used to prevent the Render service from spinning down due to inacitivity while a game is played |
| GET         | `/api/dictionary`             | | 200 | | Sends the dictionary (array of words) to the client |

<br>

## Links

### Git

[Client repository Link](https://github.com/AmVa93n/Scrabbler)

[Server repository Link](https://github.com/AmVa93n/Scrabbler-backend)

[Deployed App Link](https://scrabbler.netlify.app/)

### Slides

[Slides Link](https://slides.com/amirvaknin/scrabbler)