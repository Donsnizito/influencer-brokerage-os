import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const pandaDocClient = axios.create({
    baseURL: 'https://api.pandadoc.com/public/v1',
    headers: {
        'Authorization': `API-Key ${process.env.PANDADOC_API_KEY}`,
        'Content-Type': 'application/json'
    }
});
