// Import the WebSocketServer class from the "ws" package
import WebSocket, { WebSocketServer } from "ws";
import jwt from 'jsonwebtoken';
import { JWT_SECRET_KEY } from '@repo/backend-common/config';
import { PsClient } from '@repo/backend-common/db';

// Create a new WebSocket server listening on port 8080
const wss = new WebSocketServer({ port: 8080 });
let allSockets: WebSocket[] = [];

console.log("server created");

interface Users {
    userId: number; // Changed from Int16Array to string to match decoded JWT
    roomId: number[]; // Changed from Int16Array[] to number[] for simplicity
    ws: WebSocket;
}
 
let users: Users[] = []; // Initially an empty array to store connected users  

//--------------------------------------------------------------------------------------------------------------------------------------------

// Event listener for new client connections
wss.on("connection", function connection(socket: WebSocket, request) {

    let decoded = null;
    const url = request.url;
    const queries = url?.split('?')[1]; // Extract query parameters
    const searchParams = new URLSearchParams(queries); // Parses query parameters by using map data structure

    try {
        const token = searchParams.get('token') || ""; // Get the token from query params
        console.log(token);
        
        decoded = jwt.verify(token, JWT_SECRET_KEY) as { id: number };
        console.log(decoded);
        
        if (!decoded || !decoded.id) {
            console.log("socket is closed");
            socket.close();
            return;
        }
    } catch (error) {
        //@ts-ignore
        console.log(error.message);
        console.log('catch logic running');
        socket.close();
        return;
    }

    // when a user connects to the sever we will add the user to the users array if it does not exists currently
    try {
        users.push({
            //@ts-ignore
            userId: decoded?.id,
            roomId: [], // Initially, the user is not in any room
            ws: socket
        });
    } catch (error) {
        console.log("Error adding user to the users array:", error);
    }

    console.log("You are connected to the ws-server");
    console.log(users);

    // Listen for messages sent by the connected client
    socket.on("message", async function message(rawData) {

        try {
                    // rawData is usually string therefore we need to parse the data to the json
                    const data = JSON.parse(rawData.toString()); // Parse incoming data
                    console.log(data.type,data.roomId);

                    if (data.type === "join_room") {
                        try {
                            console.log("Checking if the user is member of room or not...")
                            console.log("User Id: ",decoded.id);
                            console.log("Room Id: ",data.roomId)
                            const isMember = await PsClient.roomMember.findFirst({
                                where: {
                                    roomId: Number(data.roomId),
                                    userId : decoded.id
                                }
                            });

                            if (!isMember) {
                                socket.send(JSON.stringify({
                                    message: "You are not member of this room"
                                }));
                                return;
                            }

                            // Find the user in the users array
                            const user = users.find((user) => user.ws === socket);
                            
                            // Add the room ID to the user's room list
                            user?.roomId.push(data.roomId);
                            socket.send(JSON.stringify({
                                message: "You have joined the room successfully",
                                user: user
                            }));
                        
                        } catch (error) {
                            console.log("Error joining room:", error);
                        }
                        return;
                    } 
                    
                    else  if (data.type === "chat") {
                        console.log("Entered in chat endpoint in ws server")
                        console.log(data.roomId);
                        console.log(decoded.id);
                        try {
                            const isMember = await PsClient.roomMember.findFirst({
                                where:{
                                    roomId : Number(data.roomId),
                                    userId : decoded.id
                                }
                            });

                            if (!isMember) {
                                socket.send(JSON.stringify({
                                    error: "You are not a member of this room."
                                }));
                                return;
                            }

                            await PsClient.chat.create({
                                data:{
                                    message: data.message,
                                    userId: decoded.id ,
                                    roomId: Number(data.roomId)
                                }
                            });

                            console.log("reached to for loop");

                            users.forEach((user) => {  // iterate to each user and check if he is a part of the roomId the current user sends us
                                // we will pass the user id in the frontend also so that we can manipulate the styling of the chat messages accordingly
                                if (Array.isArray(user.roomId) && user.roomId.includes(data.roomId) && user.ws != socket ) {
                                    if (user.ws.readyState === WebSocket.OPEN) {
                                        user.ws.send(JSON.stringify({
                                            type: "chat",
                                            message: data.message,
                                            roomId: Number(data.roomId),
                                            userId : Number(data.userId)
                                        }));
                                        console.log(`📩 Message sent to user ${user.userId} in room ${data.roomId}`);
                                    } else {
                                        console.log(`⚠️ Cannot send message, WebSocket is closed for user ${user.userId}`);
                                    }
                                } else {
                                    console.log(`❌ User ${user.userId} is NOT in room ${data.roomId}, message not sent.`);
                                    console.log(user)
                                }
                            });
                            console.log("Passed the for loop");
                        } catch (error) {
                            console.log("Error sending chat message:", error);
                            return;
                        }
                    } 
                    
                    else  if (data.type === "leave_room") {
                        try {
                            users.forEach((user) => {
                                if (user.ws === socket) {
                                    user.roomId = user.roomId.filter((room) => room !== data.roomId);
                                }
                            });
                            socket.send(JSON.stringify({
                                message: "You have left the room"
                            }));
                        } catch (error) {
                            console.log("Error leaving room:", error);
                        }
                        return;
                    } 

                    else if (data.type === "delete"){
                        console.log("entered in delete section")
                        // here we must have the message like: type: "delete", shapeId : shapeId
                        // we will get these two from the message and the userId from the token in decoded.id
                        // we will traverse through the database and delete that shape and also send the message to all other subscribed users
                        const shapeId = data.shapeId;
                        console.log("ShapeId: " ,shapeId)
                        // we will first find the entry in chat in which message field (json string) contains the shapeId
                        const chatEntry = await PsClient.chat.findFirst({
                            where: {
                                message: {
                                    contains: shapeId // Searches inside the JSON string
                                }
                            }
                        });

                        if (chatEntry) {
                                console.log("chat entry is founded")
                                await PsClient.chat.delete({
                                    where: { id: chatEntry.id } // Now we delete using the unique ID
                                });
                        }

                        // after deleting the chat from the database we will send the shapeid to be deleted  to the frontend to all the users withe the same roomid
                        users.forEach((user)=>{
                            if (Array.isArray(user.roomId) && user.roomId.includes(data.roomId) && user.ws != socket ) {
                                if (user.ws.readyState === WebSocket.OPEN) {
                                    user.ws.send(JSON.stringify({
                                        type: "delete",
                                        shapeId: data.shapeId , // this is the shape
                                        roomId: Number(data.roomId),
                                    }));
                                    console.log(`📩 Message sent to user ${user.userId} in room ${data.roomId}`);
                                } else {
                                    console.log(`⚠️ Cannot send message, WebSocket is closed for user ${user.userId}`);
                                }
                            } else {
                                console.log(`❌ User ${user.userId} is NOT in room ${data.roomId}, message not sent.`);
                                console.log(user)
                            }
                        });
                        console.log("passed the for loop");
                        
                    }
                    
                    else if ( data.type === 'cursor'){

                        users.forEach((user)=>{
                            if (Array.isArray(user.roomId) && user.roomId.includes(data.roomId) && user.ws != socket ) {
                                if (user.ws.readyState === WebSocket.OPEN) {
                                    user.ws.send(JSON.stringify({
                                        type: "cursor",
                                        location: data.location,
                                        roomId : Number(data.roomId),
                                        username : data.username
                                    }));
                                    console.log(`📩 Message sent to user ${user.userId} in room ${data.roomId}`);
                                } else {
                                    console.log(`⚠️ Cannot send message, WebSocket is closed for user ${user.userId}`);
                                }
                            } else {
                                console.log(`❌ User ${user.userId} is NOT in room ${data.roomId}, message not sent.`);
                                console.log(user)
                            }
                        });
                    }
                    
                    else {
                        socket.send(JSON.stringify({
                            message: "Entered wrong type"
                        }));
                        return;
                    }

        } catch (error) {
            console.log("Error processing message:", error);
        }
    });

    // Event listener for when the client disconnects
    socket.on("close", () => {
        try {
            users = users.filter((user) => user.ws !== socket);
            console.log("Socket has been closed");
        } catch (error) {
            console.log("Error handling socket closure:", error);
        }
    });
});
