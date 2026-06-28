import {db} from '../config/db.js';

export async function addService(name,description) {
  const query = 'INSERT INTO services (service_name, description) VALUES (?,?)'
  const [result] = await db.query(query,[name,description])
  return result.insertId
}

export async function verifyService(name) {
  const query = 'SELECT * FROM services where service_name =?'
  const [result] = await db.query(query,[name])
  return result.length
}

export async function verifyUpdateService(name,serviceID) {
  const query = `SELECT * FROM services WHERE service_name = ? AND service_id != ? LIMIT 1`
  const [result] = await db.query(query,[name,serviceID])
  return result.length
}

export async function editService(id,name,description) {
  const query = 'UPDATE services set service_name=?,description=? WHERE service_id =?'
  const [result] = await db.query(query,[name,description,id])
  return result.affectedRows
}

export async function toggleServiceStatus(id,newStatus) {
  const query = 'UPDATE services set is_active= ?  WHERE service_id =?'
  const [result] = await db.query(query,[newStatus,id])
  return result.affectedRows
}

export async function searchService(searchWord) {
  const query = 'SELECT * FROM SERVICES WHERE service_name LIKE ? OR description LIKE ?';
  const keyword = `%${searchWord}%`;
  const [result] = await db.query(query,[keyword,keyword]);
  return result;
}

export async function getServices() {
  const query = 'SELECT *  FROM services WHERE is_active= ?';
  const [rows] = await db.query(query, [1]);
  return rows;
};

export async function getAllServices() {
  const query = 'SELECT *  FROM services';
  const [rows] = await db.query(query);
  return rows;
};

export async function getClientAppointments(userId,status) {
  const query = `
    SELECT 
      a.appointment_id,
      a.appointment_date,
      a.appointment_time,
      a.created_at,
      a.notes,
      a.status,
      s.service_name
    FROM appointments a
    JOIN appointment_service aps ON a.appointment_id = aps.appointment_id
    JOIN services s ON aps.service_id = s.service_id
    WHERE a.client_id = ? ${status !=='all' ? ` AND a.status= '${status}' `:''}  
    ORDER BY a.created_at DESC
  `;


  const [rows] = await db.query(query, [userId]);

  const grouped = {};

  rows.forEach(row => {
    if (!grouped[row.appointment_id]) {
      grouped[row.appointment_id] = {
        appointment_id: row.appointment_id,
        appointment_date: row.appointment_date,
        appointment_time: row.appointment_time,
        created_at: row.created_at,
        notes: row.notes,
        status: row.status,
        services: []
      };
    }
    grouped[row.appointment_id].services.push(row.service_name);
  });

  return Object.values(grouped);
}

export async function getClientActiveAppointment(userID){
    const query =`SELECT * FROM appointments WHERE client_id= ? AND status in ( 'approved','pending') `
    const [result] = await db.query(query,userID)
    return result.length >0;
}

export async function submitClientAppointmentsModel(connection, clientId, appointmentData) {
  const appointmentId = await insertAppointment(connection,clientId,appointmentData);

  await insertAppointmentServices(connection,appointmentId,appointmentData.services);

  return appointmentId;
}

async function insertAppointment(connection, clientId, appointmentData) {
  const query = `
    INSERT INTO appointments (client_id, appointment_date, appointment_time, notes,status)
    VALUES (?, ?, ?, ?,'approved')
  `;

  const [result] = await connection.query(query, [
    clientId,
    appointmentData.date,
    appointmentData.time,
    appointmentData.notes || 'None'
  ]);

  return result.insertId;
}

async function insertAppointmentServices(connection, appointmentId, services) {
  const query = `
    INSERT INTO appointment_service (appointment_id, service_id)
    VALUES (?, ?)
  `;

  for (const serviceId of services) {
    await connection.query(query, [appointmentId, serviceId]);
  }
}

export async function cancelAppointment(appointment_id,reason) {
    const query = "UPDATE appointments set status ='cancelled', remarks = ? where appointment_id=?";
    const [result] =await db.query(query,[reason,appointment_id])
    return result.affectedRows 
    
}

export async function filterClientAppointments(status) {
  const today = new Date().toISOString().split('T')[0]; 

  let whereClause = '';

switch (status) {
  case 'today':
    whereClause = `WHERE a.status = 'approved' AND a.appointment_date = '${today}'`;
    break;

  case 'all':
    whereClause = ''; 
    break;

  default:
    whereClause = `WHERE a.status = '${status}'`;
}

 
  const query = `
  SELECT 
    CONCAT(u.first_name, ', ', u.last_name) AS full_name,
    u.email,
    a.appointment_id,
    a.appointment_date,
    a.appointment_time,
    a.created_at,
    a.notes,
    a.status,
    s.service_name
  FROM appointments a
  JOIN appointment_service aps ON a.appointment_id = aps.appointment_id
  JOIN users u ON a.client_id = u.id
  JOIN services s ON aps.service_id = s.service_id
  ${ whereClause }
  ORDER BY a.appointment_id


  
`;

  const [rows] = await db.query(query);

  const grouped = {};

  rows.forEach(row => {
    if (!grouped[row.appointment_id]) {
      grouped[row.appointment_id] = {
        client_name: row.full_name,
        appointment_id: row.appointment_id,
        appointment_date: row.appointment_date,
        appointment_time: row.appointment_time,
        created_at: row.created_at,
        notes: row.notes,
        status: row.status,
        services: []
      };
    }
    grouped[row.appointment_id].services.push(row.service_name);
  });

  return Object.values(grouped);
}

// ADMIN APPOINTMENT MANAGEMENT

export async function getAllAppointmentsModel(status, date, page, limit) {
  const offset = (page - 1) * limit;
  
  let query = `
    SELECT 
      a.appointment_id,
      a.appointment_date,
      a.appointment_time,
      a.notes,
      a.status,
      a.remarks,
      a.created_at,
      a.updated_at,
      u.id as client_id,
      u.email,
      u.first_name,
      u.last_name,
      u.phone_number,
      GROUP_CONCAT(s.service_name SEPARATOR ', ') as services
    FROM appointments a
    JOIN users u ON a.client_id = u.id
    LEFT JOIN appointment_service aps ON a.appointment_id = aps.appointment_id
    LEFT JOIN services s ON aps.service_id = s.service_id
  `;

  const conditions = [];
  const params = [];

  if (status) {
    conditions.push('a.status = ?');
    params.push(status);
  }

  if (date) {
    conditions.push('a.appointment_date = ?');
    params.push(date);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' GROUP BY a.appointment_id ORDER BY a.appointment_date DESC, a.appointment_time DESC';
  query += ' LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const [appointments] = await db.query(query, params);
  return appointments;
}

export async function getAppointmentCountModel(status, date) {
  let query = 'SELECT COUNT(*) as total FROM appointments a';
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push('a.status = ?');
    params.push(status);
  }

  if (date) {
    conditions.push('a.appointment_date = ?');
    params.push(date);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  const [result] = await db.query(query, params);
  return result[0].total;
}

export async function getAppointmentWithClientInfoModel( appointmentId) {
  const query = `
    SELECT 
      a.appointment_id,
      a.appointment_date,
      a.appointment_time,
      a.status as old_status,
      u.id as client_id,
      u.email,
      u.first_name,
      u.last_name,
      GROUP_CONCAT(s.service_name SEPARATOR ', ') as services
    FROM appointments a
    JOIN users u ON a.client_id = u.id
    LEFT JOIN appointment_service aps ON a.appointment_id = aps.appointment_id
    LEFT JOIN services s ON aps.service_id = s.service_id
    WHERE a.appointment_id = ?
    GROUP BY a.appointment_id
  `;
  
  const [result] = await db.query(query, [appointmentId]);
  return result.length > 0 ? result[0] : null;
}

export async function updateAppointmentStatusModel( appointmentId, status, remarks) {
  const query = `
    UPDATE appointments 
    SET status = ?, remarks = ?, updated_at = NOW() 
    WHERE appointment_id = ?
  `;
  
  const [result] = await db.query(query, [status, remarks || null, appointmentId]);
  return result.affectedRows;
}

// TIME SLOT MANAGEMENT (ADMIN)

export async function getTimeSlotsByDateModel(date) {
  const query = `
    SELECT 
      slot_id,
      DATE_FORMAT(appointment_date, '%Y-%m-%d') AS appointment_date,
      TIME_FORMAT(appointment_time, '%H:%i:%s')  AS appointment_time,
      max_capacity,
      current_bookings,
      is_available,
      (max_capacity - current_bookings) as spots_available
    FROM appointment_time_slots
    WHERE appointment_date = ?
    ORDER BY appointment_time ASC
  `;
  
  const [slots] = await db.query(query, [date]);
  return slots;
}

export async function updateTimeSlotModel(slotId, maxCapacity, isAvailable) {
  const updates = [];
  const params = [];

  if (maxCapacity !== undefined) {
    updates.push('max_capacity = ?');
    params.push(maxCapacity);
  }

  if (isAvailable !== undefined) {
    updates.push('is_available = ?');
    params.push(isAvailable);
  }

  if (updates.length === 0) {
    return 0;
  }

  updates.push('updated_at = NOW()');
  params.push(slotId);

  const query = `UPDATE appointment_time_slots SET ${updates.join(', ')} WHERE slot_id = ?`;
  const [result] = await db.query(query, params);
  return result.affectedRows;

}

export const getScheduleForecastModel = async (startDate, endDate) => {
  // 1. Get all time slots in the date range with booking counts
  const [slots] = await db.execute(
    `SELECT
        ts.slot_id,
        DATE_FORMAT(ts.appointment_date, '%Y-%m-%d') AS appointment_date,
        TIME_FORMAT(ts.appointment_time, '%H:%i:%s')  AS appointment_time,
        ts.max_capacity,
        ts.current_bookings,
        ts.is_available,
        COUNT(a.appointment_id) AS actual_bookings
     FROM appointment_time_slots ts
     LEFT JOIN appointments a
       ON  a.appointment_date = ts.appointment_date
       AND a.appointment_time = ts.appointment_time
       AND a.status != 'cancelled'
     WHERE ts.appointment_date BETWEEN ? AND ?
     GROUP BY
       ts.slot_id,
       ts.appointment_date,
       ts.appointment_time,
       ts.max_capacity,
       ts.current_bookings,
       ts.is_available
     ORDER BY ts.appointment_date ASC, ts.appointment_time ASC`,
    [startDate, endDate]
  );

  // 2. Get all booked clients in the date range (non-cancelled appointments)
  const [bookings] = await db.execute(
    `SELECT
       a.appointment_id,
       DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
       TIME_FORMAT(a.appointment_time, '%H:%i:%s')  AS appointment_time,
       a.status,
       a.notes,
       u.id           AS client_id,
       u.first_name,
       u.last_name,
       u.email,
       GROUP_CONCAT(s.service_name ORDER BY s.service_name SEPARATOR ', ') AS services
     FROM appointments a
     INNER JOIN users u ON a.client_id = u.id
     LEFT JOIN appointment_service aps ON aps.appointment_id = a.appointment_id
     LEFT JOIN services s ON s.service_id = aps.service_id
     WHERE a.appointment_date BETWEEN ? AND ?
       AND a.status != 'cancelled'
     GROUP BY
       a.appointment_id,
       a.appointment_date,
       a.appointment_time,
       a.status,
       a.notes,
       u.id,
       u.first_name,
       u.last_name,
       u.email,
       u.phone_number
     ORDER BY a.appointment_date ASC, a.appointment_time ASC`,
    [startDate, endDate]
  );

  // 3. Compute summary stats
  const totalBooked      = bookings.length;
  const uniqueClients    = new Set(bookings.map(b => b.client_id)).size;
  const slotsOpen        = slots.filter(s => s.is_available && s.actual_bookings < s.max_capacity).length;
  const slotsFull        = slots.filter(s => s.actual_bookings >= s.max_capacity).length;
  const slotsUnavailable = slots.filter(s => !s.is_available).length;

  return {
    slots,
    bookings,
    summary: {
      totalBooked,
      uniqueClients,
      slotsOpen,
      slotsFull,
      slotsUnavailable,
    },
  };
};
