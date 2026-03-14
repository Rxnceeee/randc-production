import mysql from 'mysql2/promise';


export const db = mysql.createPool({
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT) || 3306,  
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  // queueLimit: 0,
  // ...(process.env.NODE_ENV === 'production' && { ssl: { rejectUnauthorized: false } }), 
});

(async () => {
  try {
    const connection = await db.getConnection();
    console.log(`MySQL connected ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME || 'capstone'}`);
    connection.release();
  } catch (err) {
    console.error('MySQL connection failed:', err.message);
    console.error('Check DB_HOST, DB_USER, DB_PASSWORD, DB_NAME in your .env file.');

}
})();
