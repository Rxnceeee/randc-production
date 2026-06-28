import 'dotenv/config';
import bcrypt from 'bcrypt';
import { db } from './src/config/db.js';

async function seed() {
  const conn = await db.getConnection();
  try {
    // ── 1. SERVICES ───────────────────────────────────────────────────────────
    console.log('Seeding services...');
    const services = [
      ['Land Title Transfer',        'Full processing of real property title transfer including BIR CAR, CGT, DST, and annotation at the Register of Deeds.'],
      ['Extra Judicial Settlement',  'Document preparation and processing for estate settlement among heirs without court proceedings.'],
      ['Deed of Sale Preparation',   'Drafting and notarization of Deed of Absolute Sale for real property transactions.'],
      ['Real Property Tax Clearance','Assistance in obtaining RPT clearance and tax declaration updates from the local government.'],
      ['BIR CAR Processing',         'Processing of Certificate Authorizing Registration from the Bureau of Internal Revenue.'],
      ['Annotation of Mortgage',     'Filing and annotation of mortgage or encumbrance on the title at the Register of Deeds.'],
      ['Reconstitution of Title',    'Processing of lost or destroyed Torrens title reconstitution with the Land Registration Authority.'],
    ];

    for (const [name, desc] of services) {
      await conn.execute(
        `INSERT IGNORE INTO services (service_name, description, is_active)
         VALUES (?, ?, 1)`,
        [name, desc]
      );
    }
    console.log(`  ✓ ${services.length} services`);

    // ── 2. ADMIN USER ─────────────────────────────────────────────────────────
    console.log('Seeding admin user...');
    const passwordHash = await bcrypt.hash('Admin@1234', 10);
    await conn.execute(
      `INSERT IGNORE INTO users
         (username, email, first_name, last_name, password, role, is_active, is_verified)
       VALUES (?, ?, ?, ?, ?, 'admin', 1, 1)`,
      ['admin', 'admin@randc.com', 'Admin', 'User', passwordHash]
    );
    console.log('  ✓ admin@randc.com / Admin@1234');

    // ── 3. TEST CLIENT USER ───────────────────────────────────────────────────
    console.log('Seeding test client...');
    const clientHash = await bcrypt.hash('Client@1234', 10);
    await conn.execute(
      `INSERT IGNORE INTO users
         (username, email, first_name, last_name, password, role, is_active, is_verified)
       VALUES (?, ?, ?, ?, ?, 'client', 1, 1)`,
      ['testclient', 'client@randc.com', 'Juan', 'dela Cruz', clientHash]
    );
    console.log('  ✓ client@randc.com / Client@1234');

    // ── 4. APPOINTMENT TIME SLOTS (next 14 days, Mon–Sat) ────────────────────
    console.log('Seeding time slots...');
    const times = ['08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];
    const today = new Date();
    let slotCount = 0;

    for (let d = 1; d <= 14; d++) {
      const date = new Date(today);
      date.setDate(today.getDate() + d);
      if (date.getDay() === 0) continue; // skip Sunday

      const dateStr = date.toISOString().slice(0, 10);
      for (const time of times) {
        await conn.execute(
          `INSERT IGNORE INTO appointment_time_slots
             (appointment_date, appointment_time, max_capacity, current_bookings, is_available)
           VALUES (?, ?, 3, 0, 1)`,
          [dateStr, time]
        );
        slotCount++;
      }
    }
    console.log(`  ✓ ${slotCount} slots across next 14 days`);

    // ── 5. STATUSES (required for document transactions) ──────────────────────
    console.log('Seeding statuses...');
    const statuses = [
      ['Pending',     'Waiting for processing'],
      ['In Progress', 'Currently being processed'],
      ['Ready',       'Ready for client pickup'],
      ['Completed',   'Document released to client'],
      ['Cancelled',   'Transaction cancelled'],
    ];
    for (const [name, desc] of statuses) {
      await conn.execute(
        `INSERT IGNORE INTO status (status_name, description) VALUES (?, ?)`,
        [name, desc]
      );
    }
    console.log(`  ✓ ${statuses.length} statuses`);

    console.log('\nSeed complete.');
    console.log('\nTest accounts:');
    console.log('  Admin  → admin@randc.com   / Admin@1234');
    console.log('  Client → client@randc.com  / Client@1234');
  } finally {
    conn.release();
    await db.end();
  }
}

seed().catch(e => { console.error('Seed failed:', e.message); process.exit(1); });
