const PDFDocument = require('pdfkit'); // Using core pdfkit primitives for strict layout control
const path = require('path');
const fs = require('fs');
const Customer = require('../models/Customer');
const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');
const { calculatePeriodEnd } = require("../utils/invoiceHelpers");


const logoPath = path.join(__dirname, '../public/SKYLINKPNGWITHLOGO.png');

/**
 * Helper to safely draw a solid true black border box with running vertical gridlines.
 */
function drawTableGrid(doc, x, y, width, height, columnsWidths) {
  doc.lineWidth(1).strokeColor('#000000');
  doc.rect(x, y, width, height).stroke();
  
  // Header underline
  doc.moveTo(x, y + 22).lineTo(x + width, y + 22).stroke();
  
  // Vertical column dividers matching specific column dimensions
  let currentX = x;
  for (let i = 0; i < columnsWidths.length - 1; i++) {
    currentX += columnsWidths[i];
    doc.moveTo(currentX, y).lineTo(currentX, y + height).stroke();
  }
}

/**
 * Generate a clean, single-item receipt PDF for a given payment showing funds ingestion.
 */
async function generateReceipt(paymentId) {
  const payment = await Payment.findById(paymentId)
    .populate('customerId')
    .populate('packageId');

  if (!payment) throw new Error('Payment not found');
  
  // Directly querying Customer model to handle undefined names cleanly
  const customer = await Customer.findById(payment.customerId);
  if (!customer) throw new Error('Customer not found');

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        size: 'A4', 
        margins: { top: 35, bottom: 35, left: 40, right: 40 } 
      });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const contentWidth = doc.page.width - 80; 
      const rightHeaderX = doc.page.width - 40 - 150; 

      // --- RECEIVED STAMP OVERLAY ---
      doc.save();
      doc.translate(220, 200);
      doc.rotate(-12);
      doc.lineWidth(3).strokeColor('#16a34a');
      doc.rect(0, 0, 130, 42).stroke();
      doc.fillColor('#16a34a');
      doc.font('Helvetica-Bold').fontSize(18).text('RECEIVED', 16, 8, { letterSpacing: 1.5 });
      doc.font('Helvetica-Bold').fontSize(8.5).text(
        new Date(payment.createdAt).toLocaleDateString('en-GB'), 
        16, 28
      );
      doc.restore();

      // --- HEADER SECTION ---
      const startY = 35;
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 40, startY, { width: 140 });
      }
      
      doc.font('Helvetica-Oblique')
         .fontSize(8.5)
         .fillColor('#000000')
         .text('"Exceptional ICT Service Provider"', 40, startY + 58, { width: 140, alignment: 'center' });

      const rightHeaderTexts = 
        'SKYLINK NETWORKS\n' +
        'Highway Towers Building,\n' +
        '2nd Floor, South Wing, Suite 227,\n' +
        'P.O. Box 4580-20100,\n' +
        'Nakuru.\n\n' +
        'Tel: +254735 013 972 / +254725 013 972\n' +
        'Email: info@skylinknetworks.co.ke\n' +
        'Website: www.skylinknetworks.co.ke';

      doc.font('Helvetica')
         .fontSize(10)
         .fillColor('#000000')
         .text(rightHeaderTexts, rightHeaderX, startY, { alignment: 'right', width: 240, lineHeight: 2 });

      // --- TIGHT DIVIDER LINE ---
      const dividerY = Math.max(doc.y, startY + 110);
      doc.strokeColor('#000000').lineWidth(1.5).moveTo(40, dividerY).lineTo(doc.page.width - 40, dividerY).stroke();

      // --- CENTERED DOCUMENT TITLE ---
      doc.y = dividerY + 14;
      doc.font('Helvetica-Bold')
         .fontSize(15)
         .text('RECEIPT', 40, doc.y, { alignment: 'center', width: contentWidth, letterSpacing: 1.5 });

      // --- METADATA SECTION ---
      doc.y += 14;
      const metaY = doc.y;
      
      const clientName = customer.firstName || customer.firstname || '';
      const clientLastName = customer.lastName || customer.lastname || '';
      
      doc.font('Helvetica-Bold').fontSize(9).text('TO:', 40, metaY);
      doc.font('Helvetica-Bold').fontSize(10).text(`${clientName} ${clientLastName}`.trim() || 'Client Details', 40, metaY + 14);
      doc.font('Helvetica').fontSize(9).text(`Phone: ${customer.phoneNumber || customer.phone || 'N/A'}`, 40, metaY + 28);
      // doc.font('Helvetica').fontSize(9).text(`Location: ${`${customer.city}, ${customer.subLocation}.` ||'N/A'}`, 40, metaY + 42);

      const receiptDate = new Date(payment.createdAt);
      
      doc.font('Helvetica-Bold').fontSize(9).text(`Receipt No:`, rightHeaderX, metaY, { width: 110, alignment: 'right' });
      doc.font('Helvetica').text(`${payment.mpesaReceiptNumber || payment.stkID || payment._id}`, rightHeaderX + 60, metaY, { width: 125, alignment: 'left' });
      
      doc.font('Helvetica-Bold').text(`Receipt Date:`, rightHeaderX, metaY + 14, { width: 110, alignment: 'right' });
      doc.font('Helvetica').text(`${receiptDate.toLocaleDateString('en-GB')}`, rightHeaderX + 60, metaY + 14, { width: 125, alignment: 'left' });

      // --- SIMPLIFIED SINGLE-ROW TABLE CONTAINER ---
      const tableY = metaY + 60;
      const tableHeight = 60; 
      
      const colWidths = [
        contentWidth * 0.55, 
        contentWidth * 0.10, 
        contentWidth * 0.15, 
        contentWidth * 0.20  
      ];

      drawTableGrid(doc, 40, tableY, contentWidth, tableHeight, colWidths);

      // Render Header Content
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000');
      let currentX = 40;
      doc.text('Description', currentX + 6, tableY + 7, { width: colWidths[0] - 12 });
      currentX += colWidths[0];
      doc.text('Qty', currentX + 6, tableY + 7, { width: colWidths[1] - 12, alignment: 'center' });
      currentX += colWidths[1];
      doc.text('Rate', currentX + 6, tableY + 7, { width: colWidths[2] - 12, alignment: 'right' });
      currentX += colWidths[2];
      doc.text('Amount', currentX + 6, tableY + 7, { width: colWidths[3] - 12, alignment: 'right' });

      const payMethod = (payment.paymentMethod || 'MPESA').toUpperCase();
      const accountIdentifier = customer.accountId || 'N/A';
      const descriptionText = `Money received via ${payMethod} for Account: ${accountIdentifier}`;

      // Render single row item cleanly
      doc.font('Helvetica').fontSize(8.5);
      const rowY = tableY + 22 + 7;
      currentX = 40;
      
      doc.text(descriptionText, currentX + 6, rowY, { width: colWidths[0] - 12 });
      currentX += colWidths[0];
      doc.text('1', currentX + 6, rowY, { width: colWidths[1] - 12, alignment: 'center' });
      currentX += colWidths[1];
      doc.text(payment.amount.toLocaleString('en-US', { minimumFractionDigits: 2 }), currentX + 6, rowY, { width: colWidths[2] - 12, alignment: 'right' });
      currentX += colWidths[2];
      doc.text(payment.amount.toLocaleString('en-US', { minimumFractionDigits: 2 }), currentX + 6, rowY, { width: colWidths[3] - 12, alignment: 'right' });

      // --- FOOTER BLOCK ---
      const finalY = tableY + tableHeight + 20;
      doc.font('Helvetica').fontSize(9.5);
      doc.text(`Total Amount Paid: KES ${payment.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 40, finalY);
      
      if (payment.mpesaReceiptNumber) {
        doc.text(`M-Pesa Reference: ${payment.mpesaReceiptNumber}`, 40, finalY + 15);
      }

      doc.moveDown(3);
      doc.font('Helvetica-Oblique')
         .fontSize(9)
         .text('Thank you for choosing Skylink Networks. This is an official Skylink Networks document confirming recieved payment from the shown account.', 40, doc.y, { alignment: 'center', width: contentWidth });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generate a new subscription receipt document specifically for transactions of type subscription.
 */
async function generateSubscriptionReceipt(transactionId) {
  const transaction = await Transaction.findById(transactionId).populate('packageId');
  if (!transaction) throw new Error('Subscription transaction not found');


  const packageDoc = transaction.packageId;

  const customer = await Customer.findById(transaction.customerId);
  if (!customer) throw new Error('Customer not found');

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        size: 'A4', 
        margins: { top: 35, bottom: 35, left: 40, right: 40 } 
      });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const contentWidth = doc.page.width - 80; 
      const rightHeaderX = doc.page.width - 40 - 150; 

      // --- PAID IN FULL STAMP OVERLAY ---
      doc.save();
      doc.translate(220, 200);
      doc.rotate(-12);
      doc.lineWidth(3).strokeColor('#16a34a');
      doc.rect(0, 0, 140, 42).stroke();
      doc.fillColor('#16a34a');
      doc.font('Helvetica-Bold').fontSize(16).text('PAID', 10, 8, { letterSpacing: 1.5 });
      doc.font('Helvetica-Bold').fontSize(8.5).text(
        new Date(transaction.createdAt).toLocaleDateString('en-GB'), 
        15, 28
      );
      doc.restore();

      // --- HEADER SECTION ---
      const startY = 35;
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 40, startY, { width: 140 });
      }
      
      doc.font('Helvetica-Oblique')
         .fontSize(8.5)
         .fillColor('#000000')
         .text('"Exceptional ICT Service Provider"', 40, startY + 58, { width: 140, alignment: 'center' });

      const rightHeaderTexts = 
        'SKYLINK NETWORKS\n' +
        'Highway Towers Building,\n' +
        '2nd Floor, South Wing, Suite 227,\n' +
        'P.O. Box 4580-20100,\n' +
        'Nakuru.\n\n' +
        'Tel: +254735 013 972 / +254725 013 972\n' +
        'Email: info@skylinknetworks.co.ke\n' +
        'Website: www.skylinknetworks.co.ke';

      doc.font('Helvetica')
         .fontSize(10)
         .fillColor('#000000')
         .text(rightHeaderTexts, rightHeaderX, startY, { alignment: 'right', width: 240, lineHeight: 2 });

      // --- TIGHT DIVIDER LINE ---
      const dividerY = Math.max(doc.y, startY + 110);
      doc.strokeColor('#000000').lineWidth(1.5).moveTo(40, dividerY).lineTo(doc.page.width - 40, dividerY).stroke();

      // --- CENTERED DOCUMENT TITLE ---
      doc.y = dividerY + 14;
      doc.font('Helvetica-Bold')
         .fontSize(15)
         .text('SUBSCRIPTION RECEIPT', 40, doc.y, { alignment: 'center', width: contentWidth, letterSpacing: 1.5 });

      // --- METADATA SECTION ---
      doc.y += 14;
      const metaY = doc.y;
      
      const clientName = customer.firstName || customer.firstname || '';
      const clientLastName = customer.lastName || customer.lastname || '';
      
      doc.font('Helvetica-Bold').fontSize(9).text('TO:', 40, metaY);
      doc.font('Helvetica-Bold').fontSize(10).text(`${clientName} ${clientLastName}`.trim() || 'Client Details', 40, metaY + 14);
      doc.font('Helvetica').fontSize(9).text(`Account ID: ${customer.accountId || 'N/A'}`, 40, metaY + 28);

      const txnDate = new Date(transaction.createdAt);
      
      doc.font('Helvetica-Bold').fontSize(9).text(`Receipt No:`, rightHeaderX, metaY, { width: 110, alignment: 'right' });
      doc.font('Helvetica').text(`${transaction._id}`, rightHeaderX + 60, metaY, { width: 125, alignment: 'left' });
      
      doc.font('Helvetica-Bold').text(`Issue Date:`, rightHeaderX, metaY + 14, { width: 110, alignment: 'right' });
      doc.font('Helvetica').text(`${txnDate.toLocaleDateString('en-GB')}`, rightHeaderX + 60, metaY + 14, { width: 125, alignment: 'left' });

      // --- TABLE LAYOUT CONTROLS ---
      const tableY = metaY + 60;
      const tableHeight = 60; 
      
      const colWidths = [
        contentWidth * 0.55, 
        contentWidth * 0.10, 
        contentWidth * 0.15, 
        contentWidth * 0.20  
      ];

      drawTableGrid(doc, 40, tableY, contentWidth, tableHeight, colWidths);

      // Render Header Content
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000');
      let currentX = 40;
      doc.text('Description', currentX + 6, tableY + 7, { width: colWidths[0] - 12 });
      currentX += colWidths[0];
      doc.text('Qty', currentX + 6, tableY + 7, { width: colWidths[1] - 12, alignment: 'center' });
      currentX += colWidths[1];
      doc.text('Rate', currentX + 6, tableY + 7, { width: colWidths[2] - 12, alignment: 'right' });
      currentX += colWidths[2];
      doc.text('Amount', currentX + 6, tableY + 7, { width: colWidths[3] - 12, alignment: 'right' });

      // Calculate the subscription service timeline boundaries (30-day billing window duration)
      const dateFrom = new Date(transaction.createdAt);
      const dateTo =  calculatePeriodEnd(dateFrom, packageDoc.period, packageDoc.periodUnit);
      dateTo.setDate(dateTo.getDate() + 30);

      const formattedFrom = dateFrom.toLocaleDateString('en-GB');
      const formattedTo = dateTo.toLocaleDateString('en-GB');
      
      // Build safe custom service description string using transaction summary
      const planDescription = transaction.description || 'Data Package Subscription Charge';
      const descriptionText = `Subscription for ${packageDoc.packageName} (Period: ${formattedFrom} to ${formattedTo})`;
      const itemAmount = Math.abs(transaction.amount);

      // Render single data row item cleanly
      doc.font('Helvetica').fontSize(8.5);
      const rowY = tableY + 22 + 7;
      currentX = 40;
      
      doc.text(descriptionText, currentX + 6, rowY, { width: colWidths[0] - 12 });
      currentX += colWidths[0];
      doc.text('1', currentX + 6, rowY, { width: colWidths[1] - 12, alignment: 'center' });
      currentX += colWidths[1];
      doc.text(itemAmount.toLocaleString('en-US', { minimumFractionDigits: 2 }), currentX + 6, rowY, { width: colWidths[2] - 12, alignment: 'right' });
      currentX += colWidths[2];
      doc.text(itemAmount.toLocaleString('en-US', { minimumFractionDigits: 2 }), currentX + 6, rowY, { width: colWidths[3] - 12, alignment: 'right' });

      // --- FOOTER BLOCK ---
      const finalY = tableY + tableHeight + 20;
      doc.font('Helvetica').fontSize(9.5);
      doc.text(`Total Charges: KES ${itemAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 40, finalY);
      doc.text(`Status: Paid In Full.`, 40, finalY + 15);

      doc.moveDown(3);
      doc.font('Helvetica-Oblique')
         .fontSize(9)
         .text('Thank you for your business. This is an official Skylink Networks document confirming service subscription for the shown period.', 40, doc.y, { alignment: 'center', width: contentWidth });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generate a statement PDF displaying movement details without computed running balances.
 */
async function generateStatement(customerId, startDate, endDate) {
  const customer = await Customer.findById(customerId);
  if (!customer) throw new Error('Customer not found');

  const transactions = await Transaction.find({
    customerId: customer._id,
    createdAt: { $gte: startDate, $lte: endDate }
  }).sort({ createdAt: 1 }).populate('packageId');

  console.log("Transactions: ", transactions);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        size: 'A4', 
        margins: { top: 35, bottom: 35, left: 40, right: 40 } 
      });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const contentWidth = doc.page.width - 80;
      const rightHeaderX = doc.page.width - 40 - 150;

      // --- HEADER SECTION ---
      const startY = 35;
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 40, startY, { width: 140 });
      }
      
      doc.font('Helvetica-Oblique')
         .fontSize(8.5)
         .fillColor('#000000')
         .text('"Exceptional ICT Service Provider"', 40, startY + 58, { width: 140, alignment: 'center' });

      const rightHeaderTexts = 
        'SKYLINK NETWORKS\n' +
        'Highway Towers Building,\n' +
        '2nd Floor, South Wing, Suite 227,\n' +
        'P.O. Box 4580-20100,\n' +
        'Nakuru.\n\n' +
        'Tel: +254735 013 972 / +254725 013 972\n' +
        'Email: info@skylinknetworks.co.ke\n' +
        'Website: www.skylinknetworks.co.ke';

      doc.font('Helvetica')
         .fontSize(10)
         .fillColor('#000000')
         .text(rightHeaderTexts, rightHeaderX, startY, { alignment: 'right', width: 240, lineHeight: 2 });

      // --- TIGHT DIVIDER LINE ---
      const dividerY = Math.max(doc.y, startY + 110);
      doc.strokeColor('#000000').lineWidth(1.5).moveTo(40, dividerY).lineTo(doc.page.width - 40, dividerY).stroke();

      // --- CENTERED DOCUMENT TITLE ---
      doc.y = dividerY + 14;
      doc.font('Helvetica-Bold')
         .fontSize(15)
         .text('ACCOUNT STATEMENT', 40, doc.y, { alignment: 'center', width: contentWidth, letterSpacing: 1.5 });

      // --- METADATA SECTION ---
      doc.y += 14;
      const metaY = doc.y;
      
      const clientName = customer.firstName || customer.firstname || '';
      const clientLastName = customer.lastName || customer.lastname || '';

      doc.font('Helvetica-Bold').fontSize(9).text('TO:', 40, metaY);
      doc.font('Helvetica-Bold').fontSize(10).text(`${clientName} ${clientLastName}`.trim() || 'Client Details', 40, metaY + 14);
      doc.font('Helvetica').fontSize(9).text(`Account ID: ${customer.accountId}`, 40, metaY + 28);

      doc.font('Helvetica-Bold').fontSize(9).text(`Period:`, rightHeaderX, metaY, { width: 110, alignment: 'right' });
      doc.font('Helvetica').text(`${startDate.toLocaleDateString('en-GB')} - ${endDate.toLocaleDateString('en-GB')}`, rightHeaderX + 50, metaY, { width: 125, alignment: 'left' });

      // --- TABLE CONFIGURATION ---
      const tableY = metaY + 60;
      const colWidths = [
        75,                  // Date
        contentWidth - 255,  // Description
        90,                  // Debit
        90                   // Credit
      ];

      const headers = ['Date', 'Description', 'Debit', 'Credit'];
      const alignments = ['left', 'left', 'right', 'right'];

      let currentY = tableY;

      // Draw Initial Header Background and Borders
      doc.lineWidth(1).strokeColor('#000000');
      doc.rect(40, currentY, contentWidth, 22).fillAndStroke('#f3f4f6', '#000000');
      doc.fillColor('#000000');
      doc.font('Helvetica-Bold').fontSize(8.5);

      let currentX = 40;
      for (let i = 0; i < headers.length; i++) {
        doc.text(headers[i], currentX + 6, currentY + 7, {
          width: colWidths[i] - 12,
          alignment: alignments[i]
        });
        currentX += colWidths[i];
      }

      // Vertical separators for the Header row
      let headerSepX = 40;
      for (let i = 0; i < colWidths.length - 1; i++) {
        headerSepX += colWidths[i];
        doc.moveTo(headerSepX, currentY).lineTo(headerSepX, currentY + 22).stroke();
      }

      currentY += 22;

      // --- DYNAMIC TRANSACTION ROWS LOOP ---
      doc.font('Helvetica').fontSize(8.5);

      for (let i = 0; i < transactions.length; i++) {
        const txn = transactions[i];
        const txnType = (txn.type || '').toLowerCase();
        const rawAmount = Math.abs(txn.amount);

        let debit = '-';
        let credit = '-';
        let clearDescription = "";

        if (txnType === 'wallet') {
          clearDescription = "Funds added to wallet balance.";
        } else if (txnType === 'mpesa') {
          clearDescription = "Funds received into the account via M-Pesa.";
        } else if (txnType === 'cash_deposit') {
          clearDescription = `Funds deposited into the account. Source: ${txn.paymentMethod || 'N/A'}`;
        } else if (txnType === "moved_payment") {
          clearDescription = `Funds deposited into the account. Source: ${txn.paymentMethod || 'N/A'}`;
        } else if (txnType === "subscription") {
          clearDescription = `Subscription renewal for package ${txn?.packageId?.packageName || 'N/A'}`;
        } else {
          clearDescription = `Funds deducted from account. Reason: ${txn.description || 'N/A'}`;
        }

        if (txnType === 'mpesa' || txnType === 'cash_deposit' || txnType === 'moved_payment') {
          credit = rawAmount.toFixed(2);
        } else if (txnType !== 'wallet') {
          debit = rawAmount.toFixed(2);
        }

        const dateText = new Date(txn.createdAt).toLocaleDateString('en-GB');

        // Dynamic height calculations to completely prevent overlapping texts
        const dateHeight = doc.heightOfString(dateText, { width: colWidths[0] - 12 });
        const descHeight = doc.heightOfString(clearDescription, { width: colWidths[1] - 12, lineGap: 2 });
        const debitHeight = doc.heightOfString(debit, { width: colWidths[2] - 12 });
        const creditHeight = doc.heightOfString(credit, { width: colWidths[3] - 12 });

        const rowHeight = Math.max(
          24, // baseline fallback height
          dateHeight,
          descHeight,
          debitHeight,
          creditHeight
        ) + 8;

        // --- AUTOMATIC PAGINATION BREAK CHECK ---
        if (currentY + rowHeight > doc.page.height - 80) {
          doc.addPage();
          currentY = 40;

          // Re-draw header container structure on new layout instance
          doc.lineWidth(1).strokeColor('#000000');
          doc.rect(40, currentY, contentWidth, 22).fillAndStroke('#f3f4f6', '#000000');
          doc.fillColor('#000000');
          doc.font('Helvetica-Bold').fontSize(8.5);

          let headerX = 40;
          for (let j = 0; j < headers.length; j++) {
            doc.text(headers[j], headerX + 6, currentY + 7, {
              width: colWidths[j] - 12,
              alignment: alignments[j]
            });
            headerX += colWidths[j];
          }

          let pageHeaderSepX = 40;
          for (let j = 0; j < colWidths.length - 1; j++) {
            pageHeaderSepX += colWidths[j];
            doc.moveTo(pageHeaderSepX, currentY).lineTo(pageHeaderSepX, currentY + 22).stroke();
          }

          currentY += 22;
          doc.font('Helvetica').fontSize(8.5);
        }

        // Frame the cell bounding perimeter box
        doc.lineWidth(1).strokeColor('#000000');
        doc.rect(40, currentY, contentWidth, rowHeight).stroke();

        // Inject inside runtime running vertical separating column rails
        let runX = 40;
        for (let j = 0; j < colWidths.length - 1; j++) {
          runX += colWidths[j];
          doc.moveTo(runX, currentY).lineTo(runX, currentY + rowHeight).stroke();
        }

        // Render cell data metrics
        let printX = 40;
        doc.fillColor('#000000');

        doc.text(dateText, printX + 6, currentY + 4, { width: colWidths[0] - 12 });
        printX += colWidths[0];

        doc.text(clearDescription, printX + 6, currentY + 4, { width: colWidths[1] - 12, lineGap: 2 });
        printX += colWidths[1];

        doc.text(debit, printX + 6, currentY + 4, { width: colWidths[2] - 12, alignment: 'right' });
        printX += colWidths[2];

        doc.text(credit, printX + 6, currentY + 4, { width: colWidths[3] - 12, alignment: 'right' });

        currentY += rowHeight;
      }

      // --- STATEMENT FOOTER ---
      const footerY = currentY + 25;
      
      // Ensure footer itself has enough bottom margin context on the page or shift safely
      if (footerY > doc.page.height - 40) {
        doc.addPage();
        doc.font('Helvetica-Oblique')
           .fontSize(8.5)
           .text('This is an official Skylink Networks document showing transactional statements of the named account for the shown period.', 40, 40, { alignment: 'center', width: contentWidth });
      } else {
        doc.font('Helvetica-Oblique')
           .fontSize(8.5)
           .text('This is an official Skylink Networks document showing transactional statements of the named account for the shown period.', 40, footerY, { alignment: 'center', width: contentWidth });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateReceipt,
  generateSubscriptionReceipt,
  generateStatement
};

