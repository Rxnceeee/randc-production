import jwt from "jsonwebtoken";

//code na nandito ay magchecheck kung nakalogin ba yung user before payagan mag request



export function verifyAccessRole(allowedRoles) {
  return (req, res, next) => {
    try {
      const role = req.user.role;

      if (!role) {
        return res.status(401).json({ message: "User role not found" });
      }

      // Ensure allowedRoles is always an array
      const roles = Array.isArray(allowedRoles)
        ? allowedRoles
        : [allowedRoles];

      if (!roles.includes(role)) {
        return res.status(403).json({
          message: `Access denied for role: ${role}`
        });
      }

      next();
    } catch (error) {
      console.error("Access role error:", error.message);
      return res.status(401).json({ message: "Access role not allowed" });
    }
  };
}


export function isUserAuthenticated(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ message: "Authorization header missing" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "Token missing" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;

    next();
  } catch (error) {
    console.error("Auth error:", error.message);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

export function generateJWT(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      username: user.username,
      email: user.email,
      first_name: user.first_name
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}
