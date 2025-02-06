// src/services/invoiceService.js
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

/**
 * Generates a PDF invoice based on the provided order data.
 * @param {object} orderData - Contains order id, customer details, and items.
 * @returns {Promise<string>} - Resolves with the file path of the generated invoice.
 */
const generateInvoice = (orderData) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument();
      const invoicesDir = path.join(process.cwd(), "invoices");
      if (!fs.existsSync(invoicesDir)) {
        fs.mkdirSync(invoicesDir);
      }
      const filePath = path.join(invoicesDir, `invoice_${orderData.id}.pdf`);
      const writeStream = fs.createWriteStream(filePath);
      doc.pipe(writeStream);

      // Add the shop logo (ensure the logo file exists at this path)
      doc.image("public/images/logo.png", { width: 100, align: "center" });
      doc.moveDown();

      // Write the invoice header
      doc.fontSize(20).text("Invoice", { align: "center" });
      doc.moveDown();

      // Write order and customer details
      doc
        .fontSize(12)
        .text(`Order ID: ${orderData.id}`)
        .text(`Customer Name: ${orderData.customer_name}`)
        .text(`Phone: ${orderData.phone}`)
        .moveDown();

      doc.text(`Delivery Address: ${orderData.delivery_address}`);
      doc.text(`Delivery Location: ${orderData.delivery_location || "N/A"}`);
      doc.text(`Billing Address: ${orderData.billing_address}`);
      doc.moveDown();

      // List products
      doc.text("Products Purchased:");
      orderData.items.forEach((item) => {
        doc.text(
          `${item.quantity} x ${item.product_name} @ ${item.product_price} each`
        );
      });
      doc.moveDown();

      // Optionally, add totals and other billing info here

      // Finalize the PDF and end the document
      doc.end();

      writeStream.on("finish", () => {
        resolve(filePath);
      });
    } catch (err) {
      reject(err);
    }
  });
};

export { generateInvoice };
