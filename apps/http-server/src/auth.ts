import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET_KEY = "24724";

export default function auth(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];    // this will return the header provided by the user
    const token = authHeader && authHeader.split(' ')[1];  // if authheader is there then token will get second part that is token , first part was Bearer else token will be non

    if (!token) {
        res.status(403).json({ message: "No token provided" });
        return 
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET_KEY);

        if (!decoded.userId) {
            res.status(403).json({ message: "Invalid token" });
            return
        }

        req.userId = decoded.userId; // Store userId in request object
        next();
    } catch (err) {
        res.status(403).json({ message: "Invalid token" });
        return 
    }
}
