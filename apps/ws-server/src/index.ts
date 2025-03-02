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
    
        try{
            const token = searchParams.get('token') ?? ""; // Get the token from query params
            console.log(token);
            
             decoded = jwt.verify(token, JWT_SECRET_KEY) as { userId: number };
            
            if (!decoded || !decoded.userId) {
                console.log("socket is closed");
                socket.close();
                return;
            }
        }
        catch(error){
            //@ts-ignore
            console.log(error.message);
            console.log('catch logic running');
            wss.close();
            return;
        }

        // when a user connects to the sever we will add the user to the users array if it does not exists currently
        users.push({
            //@ts-ignore
            userId: decoded?.userId,
            roomId: [], // Initially, the user is not in any room
            ws: socket
        });

        console.log("You are connected to the ws-server");
    

    // Listen for messages sent by the connected client
    socket.on("message", async function message(rawData) {
        // rawData is usually string therefore we need to parse the data to the json
        const data = JSON.parse(rawData.toString()); // Parse incoming data

        if (data.type === "join_room") {// it means we are subscribing the user with the room id and ensuring him that whatever future messages comes to this room, we will send you all those messages
            // joining room in ws server means to subscribe to the particular channels
            // take it like if in whatsapp we are clicking on someone's chat then we are subscribing to that room and are ready to get the message from that room, in actual practice we do store that room id into our user's array 
            // We should send him all the old thats that the room consist of previously
            const room = await PsClient.room.findFirst({
                where: {
                    id: data.roomId
                }
            });

            if (!room) {
                socket.send(JSON.stringify({
                    message: "No such room exists, try joining another room"
                }));
                return;
            }


            // Find the user in the users array
            const user = users.find((user) => user.ws === socket);
            
            // Add the room ID to the user's room list
            user?.roomId.push(data.roomId);
            socket.send(JSON.stringify({
                message: "You have joined the room successfully"
            }));
            return;
        } 
        
        else if (data.type === "chat") {
            // Broadcast message to all users in the specified room
            // we will get the roomId to which the user want's to send the message and the message he wants to send along with the type of data
            const isMember = await PsClient.roomMember.findFirst({
                where:{
                    roomId : data.roomId,
                    userId : decoded.userId
                }
            })

            if (!isMember) {
                socket.send(JSON.stringify({
                    error: "You are not a member of this room."
                }));
                return;
            }

            const newChat = await PsClient.chat.create({
                data:{
                    message: data.message,
                    userId: decoded.userId ,
                    roomId: data.roomId
                }
            })

            users.forEach((user) => {  // iterate to each user and check if he is a part of the roomId the current user sends us
                if (user.roomId.includes(data.roomId)) {  // if he is, then we will send he the message using his ws socket 
                    user.ws.send(JSON.stringify({
                        message: data.message,
                        roomId: data.roomId
                    }));
                }
            });
        } 
        
        else if (data.type === "leave_room") {// it ensures that whatever will be the message that will be sent to this room after you leave the class will not sent to you
            // Remove the room ID from the user's room list
            users.forEach((user) => {
                if (user.ws === socket) {
                    user.roomId = user.roomId.filter((room) => room !== data.roomId);
                }
            });
            socket.send(JSON.stringify({
                message: "You have left the room"
            }));
            return;
        } 
        
        else {
            // Handle incorrect message types
            socket.send(JSON.stringify({
                message: "Entered wrong type"
            }));
            return;
        }
    });

    // Event listener for when the client disconnects
    socket.on("close", () => {
        users = users.filter((user) => user.ws !== socket);
        console.log("Socket has been closed");
    });
});
