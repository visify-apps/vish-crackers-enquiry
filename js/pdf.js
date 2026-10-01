window.VishPdf = (function () {
  var COLORS = {
    night: [26, 15, 20],
    night2: [42, 21, 32],
    gold: [240, 199, 94],
    goldSoft: [255, 244, 209],
    brand: [225, 29, 46],
    good: [22, 128, 74],
    goodDeep: [15, 98, 56],
    ink: [28, 20, 24],
    muted: [106, 89, 96],
    cream: [255, 250, 247],
    rowAlt: [255, 248, 242],
    white: [255, 255, 255]
  };

  function money(n) {
    return 'Rs.' + Number(n).toLocaleString('en-IN');
  }

  function getJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
    if (window.jsPDF) return window.jsPDF;
    throw new Error('PDF library failed to load. Please refresh the page.');
  }

  function safeText(text) {
    return String(text == null ? '' : text)
      .replace(/₹/g, 'Rs.')
      .replace(/[“”″]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[¾½¼]/g, function (ch) {
        return ({ '¾': '3/4', '½': '1/2', '¼': '1/4' })[ch] || ch;
      })
      .replace(/"/g, ' in')
      .replace(/[^\x20-\x7E\n]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function savePdf(doc, filename) {
    doc.save(filename);
  }

  function pdfObjectUrl(doc) {
    var blob = doc.output('blob');
    return URL.createObjectURL(blob);
  }

  function paintStripe(doc, y, pageWidth) {
    var x = 0;
    var colors = [COLORS.gold, COLORS.brand, COLORS.goldSoft, COLORS.night2];
    var i = 0;
    while (x < pageWidth) {
      var c = colors[i % colors.length];
      doc.setFillColor(c[0], c[1], c[2]);
      doc.rect(x, y, 10, 8, 'F');
      x += 10;
      i++;
    }
  }

  function drawFooter(doc, config, pageNo, totalPages) {
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    paintStripe(doc, pageHeight - 28, pageWidth);
    doc.setFillColor(COLORS.night[0], COLORS.night[1], COLORS.night[2]);
    doc.rect(0, pageHeight - 20, pageWidth, 20, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(COLORS.goldSoft[0], COLORS.goldSoft[1], COLORS.goldSoft[2]);
    doc.text(safeText(config.brand + '  |  Made with sparks in Sivakasi'), 36, pageHeight - 8);
    doc.text('Page ' + pageNo + ' / ' + totalPages, pageWidth - 36, pageHeight - 8, { align: 'right' });
  }

  function finalizePages(doc, config) {
    var total = doc.getNumberOfPages();
    for (var i = 1; i <= total; i++) {
      doc.setPage(i);
      drawFooter(doc, config, i, total);
    }
  }

  function buildEnquiryLines(cart) {
    var rows = [];
    var total = 0;
    var mrpTotal = 0;
    Object.values(cart).forEach(function (item) {
      var line = item.price * item.quantity;
      var mrp = (item.originalPrice || item.price) * item.quantity;
      total += line;
      mrpTotal += mrp;
      rows.push({
        name: safeText(item.name),
        unit: safeText(item.unit),
        qty: item.quantity,
        price: item.price,
        mrp: item.originalPrice || item.price,
        line: line,
        saved: Math.max(0, mrp - line)
      });
    });
    return {
      rows: rows,
      total: total,
      mrpTotal: mrpTotal,
      saved: Math.max(0, mrpTotal - total)
    };
  }

  function areaLabel(contact) {
    var parts = [];
    if (contact.officeName) parts.push(contact.officeName);
    if (contact.city) parts.push(contact.city);
    if (contact.state) parts.push(contact.state);
    return parts.filter(Boolean).join(', ');
  }

  function contactBlock(contact) {
    var area = areaLabel(contact);
    var lines = [
      'Customer: ' + contact.name,
      'Mobile: ' + contact.phone,
      'Pincode: ' + contact.pincode
    ];
    if (area) lines.push('Preferred hub: ' + area);
    lines.push('Delivery mode: Parcel / courier office pickup (not doorstep)');
    lines.push(
      'Note: Once your order is dispatched from Sivakasi, the exact parcel office location, tracking ID and local contact will be shared on WhatsApp.'
    );
    return lines;
  }

  function buildWhatsAppMessage(contact, cart, config) {
    var built = buildEnquiryLines(cart);
    var area = areaLabel(contact);
    var lines = [
      'Enquiry for ' + config.brand,
      '',
      'Name: ' + contact.name,
      'Phone: ' + contact.phone,
      'Pincode: ' + contact.pincode
    ];
    if (area) lines.push('Preferred hub: ' + area);
    lines.push('Delivery: Parcel office pickup (not doorstep)');
    lines.push('');
    lines.push('Products:');
    built.rows.forEach(function (r) {
      lines.push('• ' + r.name + ' (' + r.unit + ') x ' + r.qty + ' = ' + money(r.line));
    });
    lines.push('');
    lines.push('Grand Total: ' + money(built.total));
    if (built.saved > 0) lines.push('You save vs MRP: ' + money(built.saved));
    lines.push('');
    lines.push('(Enquiry only — tracking shared after dispatch)');
    return lines.join('\n');
  }

  function openWhatsApp(config, text) {
    var url = 'https://wa.me/' + config.whatsapp + '?text=' + encodeURIComponent(text);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function downloadEnquiryPdf(contact, cart, config) {
    var jsPDF = getJsPdf();
    var doc = new jsPDF({ unit: 'pt', format: 'a4' });
    var pageWidth = doc.internal.pageSize.getWidth();
    var margin = 40;
    var contentW = pageWidth - margin * 2;
    var col = {
      product: margin + 8,
      unit: margin + 248,
      qty: margin + 338,
      rate: margin + 388,
      amount: pageWidth - margin - 8
    };
    var y = 0;

    doc.setFillColor(COLORS.night[0], COLORS.night[1], COLORS.night[2]);
    doc.rect(0, 0, pageWidth, 92, 'F');
    paintStripe(doc, 92, pageWidth);
    doc.setTextColor(COLORS.gold[0], COLORS.gold[1], COLORS.gold[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(safeText(config.brand), margin, 36);
    doc.setTextColor(COLORS.goldSoft[0], COLORS.goldSoft[1], COLORS.goldSoft[2]);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Enquiry receipt  |  Not an online order  |  Not a tax invoice', margin, 56);
    doc.text('Made with sparks in Sivakasi', margin, 72);
    y = 118;

    doc.setTextColor(COLORS.ink[0], COLORS.ink[1], COLORS.ink[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Customer details', margin, y);
    y += 14;

    doc.setFillColor(255, 248, 242);
    doc.roundedRect(margin, y, contentW, 108, 6, 6, 'F');
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(COLORS.ink[0], COLORS.ink[1], COLORS.ink[2]);
    doc.text('Date: ' + new Date().toLocaleString('en-IN'), margin + 12, y);
    y += 13;
    contactBlock(contact).forEach(function (line) {
      var wrapped = doc.splitTextToSize(safeText(line), contentW - 24);
      doc.text(wrapped, margin + 12, y);
      y += wrapped.length * 12;
    });
    y += 16;

    var built = buildEnquiryLines(cart);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(COLORS.ink[0], COLORS.ink[1], COLORS.ink[2]);
    doc.text('Items enquired (' + built.rows.length + ')', margin, y);
    y += 12;

    function drawTableHeader() {
      doc.setFillColor(COLORS.night2[0], COLORS.night2[1], COLORS.night2[2]);
      doc.roundedRect(margin, y, contentW, 22, 4, 4, 'F');
      doc.setTextColor(COLORS.gold[0], COLORS.gold[1], COLORS.gold[2]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('Product', col.product, y + 14);
      doc.text('Unit', col.unit, y + 14);
      doc.text('Qty', col.qty, y + 14);
      doc.text('Rate', col.rate, y + 14);
      doc.text('Amount', col.amount, y + 14, { align: 'right' });
      y += 28;
      doc.setTextColor(COLORS.ink[0], COLORS.ink[1], COLORS.ink[2]);
    }

    drawTableHeader();
    built.rows.forEach(function (row, idx) {
      var nameLines = doc.splitTextToSize(row.name, 220);
      var rowH = Math.max(nameLines.length * 12, 20) + 8;
      if (y + rowH > 720) {
        doc.addPage();
        y = 48;
        drawTableHeader();
      }
      if (idx % 2 === 1) {
        doc.setFillColor(COLORS.rowAlt[0], COLORS.rowAlt[1], COLORS.rowAlt[2]);
        doc.rect(margin, y - 4, contentW, rowH, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(COLORS.ink[0], COLORS.ink[1], COLORS.ink[2]);
      doc.text(nameLines, col.product, y + 8);
      doc.setTextColor(COLORS.muted[0], COLORS.muted[1], COLORS.muted[2]);
      doc.text(row.unit, col.unit, y + 8);
      doc.text(String(row.qty), col.qty, y + 8);
      doc.text(money(row.price), col.rate, y + 8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(COLORS.good[0], COLORS.good[1], COLORS.good[2]);
      doc.text(money(row.line), col.amount, y + 8, { align: 'right' });
      y += rowH;
    });

    y += 12;
    if (built.saved > 0) {
      doc.setFillColor(232, 250, 240);
      doc.roundedRect(margin, y, contentW, 28, 6, 6, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(COLORS.goodDeep[0], COLORS.goodDeep[1], COLORS.goodDeep[2]);
      doc.text('You save vs MRP', margin + 12, y + 18);
      doc.text(money(built.saved), pageWidth - margin - 12, y + 18, { align: 'right' });
      y += 36;
    }

    doc.setFillColor(COLORS.good[0], COLORS.good[1], COLORS.good[2]);
    doc.roundedRect(margin, y, contentW, 38, 6, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('Grand total', margin + 12, y + 24);
    doc.text(money(built.total), pageWidth - margin - 12, y + 24, { align: 'right' });
    y += 52;

    doc.setTextColor(COLORS.muted[0], COLORS.muted[1], COLORS.muted[2]);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    var notes = [
      config.responsePromise,
      'Door delivery of fireworks is generally not accepted in India for safety / transport rules.',
      'Contact: ' + config.ownerName + ' - ' + config.phone
    ];
    notes.forEach(function (n) {
      var wrapped = doc.splitTextToSize(safeText(n), contentW);
      doc.text(wrapped, margin, y);
      y += wrapped.length * 11 + 4;
    });

    finalizePages(doc, config);
    savePdf(doc, 'Vish-Enquiry-' + Date.now() + '.pdf');
  }

  /** VC-DDHHMM(month)mm(minutes) e.g. 01 Oct 11:34 → VC-01111034 */
  function makeBillNo(date) {
    var d = date || new Date();
    function pad(n) {
      return (n < 10 ? '0' : '') + n;
    }
    return (
      'VC-' +
      pad(d.getDate()) +
      pad(d.getHours()) +
      pad(d.getMonth() + 1) +
      pad(d.getMinutes())
    );
  }

  /**
   * Proforma / order confirmation — same theme as enquiry PDF.
   * lines: [{ name, unit, qty, price }]
   * meta: { billNo, enquirySno, notes, discount, packing, transport }
   */
  function buildBillDoc(contact, lines, config, meta) {
    var jsPDF = getJsPdf();
    var doc = new jsPDF({ unit: 'pt', format: 'a4' });
    var pageWidth = doc.internal.pageSize.getWidth();
    var margin = 40;
    var contentW = pageWidth - margin * 2;
    var col = {
      product: margin + 8,
      unit: margin + 248,
      qty: margin + 338,
      rate: margin + 388,
      amount: pageWidth - margin - 8
    };
    var y = 0;
    var billNo = (meta && meta.billNo) || makeBillNo();
    var enquirySno = meta && meta.enquirySno ? String(meta.enquirySno) : '';
    var discount = Math.max(0, Number(meta && meta.discount) || 0);
    var packing = Math.max(0, Number(meta && meta.packing) || 0);
    var transport = Math.max(0, Number(meta && meta.transport) || 0);

    var cartLike = {};
    (lines || []).forEach(function (line, idx) {
      cartLike['b' + idx] = {
        name: line.name,
        unit: line.unit || '',
        quantity: Number(line.qty) || 1,
        price: Number(line.price) || 0,
        originalPrice: Number(line.price) || 0
      };
    });
    var built = buildEnquiryLines(cartLike);
    var subtotal = built.total;
    if (discount > subtotal) discount = subtotal;
    var payable = Math.max(0, subtotal - discount + packing + transport);

    doc.setFillColor(COLORS.night[0], COLORS.night[1], COLORS.night[2]);
    doc.rect(0, 0, pageWidth, 92, 'F');
    paintStripe(doc, 92, pageWidth);
    doc.setTextColor(COLORS.gold[0], COLORS.gold[1], COLORS.gold[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(safeText(config.brand), margin, 36);
    doc.setTextColor(COLORS.goldSoft[0], COLORS.goldSoft[1], COLORS.goldSoft[2]);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Proforma / Order confirmation  |  Not a tax invoice', margin, 56);
    doc.text('Bill No: ' + billNo + (enquirySno ? '  |  Enquiry #' + enquirySno : ''), margin, 72);
    y = 118;

    doc.setTextColor(COLORS.ink[0], COLORS.ink[1], COLORS.ink[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Bill to', margin, y);
    y += 14;

    doc.setFillColor(255, 248, 242);
    doc.roundedRect(margin, y, contentW, 108, 6, 6, 'F');
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(COLORS.ink[0], COLORS.ink[1], COLORS.ink[2]);
    doc.text('Date: ' + new Date().toLocaleString('en-IN'), margin + 12, y);
    y += 13;
    contactBlock(contact).forEach(function (line) {
      var wrapped = doc.splitTextToSize(safeText(line), contentW - 24);
      doc.text(wrapped, margin + 12, y);
      y += wrapped.length * 12;
    });
    y += 16;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(COLORS.ink[0], COLORS.ink[1], COLORS.ink[2]);
    doc.text('Confirmed items (' + built.rows.length + ')', margin, y);
    y += 12;

    function drawTableHeader() {
      doc.setFillColor(COLORS.night2[0], COLORS.night2[1], COLORS.night2[2]);
      doc.roundedRect(margin, y, contentW, 22, 4, 4, 'F');
      doc.setTextColor(COLORS.gold[0], COLORS.gold[1], COLORS.gold[2]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('Product', col.product, y + 14);
      doc.text('Unit', col.unit, y + 14);
      doc.text('Qty', col.qty, y + 14);
      doc.text('Rate', col.rate, y + 14);
      doc.text('Amount', col.amount, y + 14, { align: 'right' });
      y += 28;
      doc.setTextColor(COLORS.ink[0], COLORS.ink[1], COLORS.ink[2]);
    }

    drawTableHeader();
    built.rows.forEach(function (row, idx) {
      var nameLines = doc.splitTextToSize(row.name, 220);
      var rowH = Math.max(nameLines.length * 12, 20) + 8;
      if (y + rowH > 700) {
        doc.addPage();
        y = 48;
        drawTableHeader();
      }
      if (idx % 2 === 1) {
        doc.setFillColor(COLORS.rowAlt[0], COLORS.rowAlt[1], COLORS.rowAlt[2]);
        doc.rect(margin, y - 4, contentW, rowH, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(COLORS.ink[0], COLORS.ink[1], COLORS.ink[2]);
      doc.text(nameLines, col.product, y + 8);
      doc.setTextColor(COLORS.muted[0], COLORS.muted[1], COLORS.muted[2]);
      doc.text(row.unit, col.unit, y + 8);
      doc.text(String(row.qty), col.qty, y + 8);
      doc.text(money(row.price), col.rate, y + 8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(COLORS.good[0], COLORS.good[1], COLORS.good[2]);
      doc.text(money(row.line), col.amount, y + 8, { align: 'right' });
      y += rowH;
    });

    y += 12;
    if (y > 680) {
      doc.addPage();
      y = 48;
    }

    var extraRows = 0;
    if (discount > 0) extraRows++;
    if (packing > 0) extraRows++;
    if (transport > 0) extraRows++;
    var boxH = 28 + (1 + extraRows) * 18;
    doc.setFillColor(255, 248, 242);
    doc.roundedRect(margin, y, contentW, boxH, 6, 6, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(COLORS.ink[0], COLORS.ink[1], COLORS.ink[2]);
    var ty = y + 18;
    doc.text('Subtotal', margin + 12, ty);
    doc.text(money(subtotal), pageWidth - margin - 12, ty, { align: 'right' });
    ty += 18;
    if (discount > 0) {
      doc.setTextColor(COLORS.brand[0], COLORS.brand[1], COLORS.brand[2]);
      doc.setFont('helvetica', 'bold');
      doc.text('Discount', margin + 12, ty);
      doc.text('- ' + money(discount), pageWidth - margin - 12, ty, { align: 'right' });
      ty += 18;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(COLORS.ink[0], COLORS.ink[1], COLORS.ink[2]);
    }
    if (packing > 0) {
      doc.text('Packing', margin + 12, ty);
      doc.text(money(packing), pageWidth - margin - 12, ty, { align: 'right' });
      ty += 18;
    }
    if (transport > 0) {
      doc.text('Transport', margin + 12, ty);
      doc.text(money(transport), pageWidth - margin - 12, ty, { align: 'right' });
    }
    y += boxH + 12;

    doc.setFillColor(COLORS.good[0], COLORS.good[1], COLORS.good[2]);
    doc.roundedRect(margin, y, contentW, 38, 6, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('Amount payable', margin + 12, y + 24);
    doc.text(money(payable), pageWidth - margin - 12, y + 24, { align: 'right' });
    y += 52;

    doc.setTextColor(COLORS.muted[0], COLORS.muted[1], COLORS.muted[2]);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    var notes = [
      'This is a proforma / order confirmation after discussion — not a GST tax invoice.',
      'Delivery is to your preferred parcel / courier office (not doorstep).',
      'Payment & dispatch details will be confirmed on WhatsApp.',
      'Contact: ' + config.ownerName + ' - ' + config.phone
    ];
    if (meta && meta.notes) notes.unshift(String(meta.notes));
    notes.forEach(function (n) {
      var wrapped = doc.splitTextToSize(safeText(n), contentW);
      if (y + wrapped.length * 11 > 760) {
        doc.addPage();
        y = 48;
      }
      doc.text(wrapped, margin, y);
      y += wrapped.length * 11 + 4;
    });

    finalizePages(doc, config);
    return {
      doc: doc,
      billNo: billNo,
      filename: 'Vish-Bill-' + billNo + '.pdf',
      subtotal: subtotal,
      discount: discount,
      packing: packing,
      transport: transport,
      payable: payable
    };
  }

  /** Compact A5 packing slip — product + qty only */
  function downloadPackingSlipPdf(contact, lines, config, meta) {
    var jsPDF = getJsPdf();
    var doc = new jsPDF({ unit: 'pt', format: 'a5' });
    var pageWidth = doc.internal.pageSize.getWidth();
    var margin = 28;
    var contentW = pageWidth - margin * 2;
    var y = 36;
    var billNo = (meta && meta.billNo) || makeBillNo();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(COLORS.night[0], COLORS.night[1], COLORS.night[2]);
    doc.text(safeText(config.brandShort || config.brand), margin, y);
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Packing slip  |  ' + billNo, margin, y);
    y += 14;
    if (contact && contact.name) {
      doc.text(safeText(contact.name + (contact.phone ? ' · ' + contact.phone : '')), margin, y);
      y += 12;
    }
    y += 6;
    doc.setDrawColor(200, 180, 160);
    doc.line(margin, y, pageWidth - margin, y);
    y += 14;

    (lines || []).forEach(function (line, idx) {
      var name = String(line.name || '').trim();
      if (!name) return;
      var qty = Number(line.qty) || 1;
      var unit = String(line.unit || '').trim();
      var label = name + (unit ? ' (' + unit + ')' : '');
      var wrapped = doc.splitTextToSize(label, contentW - 48);
      var rowH = Math.max(wrapped.length * 11, 14) + 6;
      if (y + rowH > 520) {
        doc.addPage();
        y = 36;
      }
      if (idx % 2 === 1) {
        doc.setFillColor(250, 245, 238);
        doc.rect(margin, y - 4, contentW, rowH, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(30, 20, 16);
      doc.text(wrapped, margin, y + 6);
      doc.setFont('helvetica', 'bold');
      doc.text('×' + qty, pageWidth - margin, y + 6, { align: 'right' });
      y += rowH;
    });

    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 100, 90);
    doc.text('Shop use only — not a tax invoice', margin, y);

    var filename = 'Vish-Pack-' + billNo + '.pdf';
    savePdf(doc, filename);
    return billNo;
  }

  function buildBillWhatsAppMessage(contact, meta, payable, config) {
    var lines = [
      'Vanakkam from ' + (config.brand || 'Vish Fireworks') + '!',
      '',
      'Proforma ready for ' + (contact.name || 'you') + '.',
      'Bill No: ' + ((meta && meta.billNo) || ''),
      meta && meta.enquirySno ? 'Enquiry #: ' + meta.enquirySno : '',
      'Amount payable: ' + money(payable),
      '',
      'I will send / attach the PDF separately on WhatsApp.',
      'Please confirm so we can proceed with payment & dispatch.',
      '',
      config.phone ? 'Call/WA: ' + config.phone : ''
    ].filter(Boolean);
    return lines.join('\n');
  }

  function createBillPreview(contact, lines, config, meta) {
    var built = buildBillDoc(contact, lines, config, meta);
    return {
      doc: built.doc,
      billNo: built.billNo,
      filename: built.filename,
      subtotal: built.subtotal,
      discount: built.discount,
      packing: built.packing,
      transport: built.transport,
      payable: built.payable,
      url: pdfObjectUrl(built.doc)
    };
  }

  function downloadBillPdf(contact, lines, config, meta) {
    var built = buildBillDoc(contact, lines, config, meta);
    savePdf(built.doc, built.filename);
    return built.billNo;
  }

  function buildPriceListDoc(productsData, config) {
    var jsPDF = getJsPdf();
    var doc = new jsPDF({ unit: 'pt', format: 'a4' });
    var pageWidth = doc.internal.pageSize.getWidth();
    var margin = 32;
    var contentW = pageWidth - margin * 2;
    var y = 0;
    var serial = 1;
    var col = {
      no: margin + 6,
      product: margin + 30,
      unit: margin + 318,
      mrp: margin + 408,
      price: pageWidth - margin - 6
    };

    doc.setFillColor(COLORS.night[0], COLORS.night[1], COLORS.night[2]);
    doc.rect(0, 0, pageWidth, 96, 'F');
    paintStripe(doc, 96, pageWidth);
    doc.setTextColor(COLORS.gold[0], COLORS.gold[1], COLORS.gold[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(safeText(config.brand), margin, 34);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(COLORS.goldSoft[0], COLORS.goldSoft[1], COLORS.goldSoft[2]);
    doc.text('Full Price List  |  Sivakasi  |  Enquiry only', margin, 54);
    doc.setFontSize(9);
    doc.text(
      safeText(config.ownerName + '  ' + config.phone + '  |  Generated ' + new Date().toLocaleDateString('en-IN')),
      margin,
      72
    );
    y = 118;

    doc.setFillColor(255, 248, 242);
    doc.roundedRect(margin, y, contentW, 42, 6, 6, 'F');
    doc.setTextColor(COLORS.muted[0], COLORS.muted[1], COLORS.muted[2]);
    doc.setFontSize(8.5);
    var legal = doc.splitTextToSize(
      'Online sale of firecrackers is not permitted. Prices are for enquiry reference only. Delivery is to your preferred parcel / courier office (not doorstep). Tracking and office details are shared on WhatsApp after dispatch from Sivakasi.',
      contentW - 20
    );
    doc.text(legal, margin + 10, y + 14);
    y += 56;

    function drawColHeader() {
      doc.setFillColor(COLORS.night[0], COLORS.night[1], COLORS.night[2]);
      doc.roundedRect(margin, y, contentW, 20, 3, 3, 'F');
      doc.setTextColor(COLORS.gold[0], COLORS.gold[1], COLORS.gold[2]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('#', col.no, y + 13);
      doc.text('Product', col.product, y + 13);
      doc.text('Unit', col.unit, y + 13);
      doc.text('MRP', col.mrp, y + 13);
      doc.text('Our Price', col.price, y + 13, { align: 'right' });
      y += 26;
      doc.setTextColor(COLORS.ink[0], COLORS.ink[1], COLORS.ink[2]);
    }

    drawColHeader();

    (productsData || []).forEach(function (cat) {
      if (y > 740) {
        doc.addPage();
        y = 48;
        drawColHeader();
      }
      doc.setFillColor(255, 237, 180);
      doc.roundedRect(margin, y, contentW, 20, 3, 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(COLORS.night2[0], COLORS.night2[1], COLORS.night2[2]);
      doc.text(safeText(String(cat.category).toUpperCase()), margin + 10, y + 14);
      y += 26;

      (cat.items || [])
        .filter(function (i) {
          return i.active !== false;
        })
        .forEach(function (item, idx) {
          var name = safeText(item.name);
          var nameLines = doc.splitTextToSize(name, 270);
          var rowH = Math.max(16, nameLines.length * 11 + 4);
          if (y + rowH > 760) {
            doc.addPage();
            y = 48;
            drawColHeader();
          }
          if (idx % 2 === 1) {
            doc.setFillColor(COLORS.rowAlt[0], COLORS.rowAlt[1], COLORS.rowAlt[2]);
            doc.rect(margin, y - 3, contentW, rowH, 'F');
          }
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8.5);
          doc.setTextColor(COLORS.muted[0], COLORS.muted[1], COLORS.muted[2]);
          doc.text(String(serial++), col.no, y + 8);
          doc.setTextColor(COLORS.ink[0], COLORS.ink[1], COLORS.ink[2]);
          doc.text(nameLines, col.product, y + 8);
          doc.setTextColor(COLORS.muted[0], COLORS.muted[1], COLORS.muted[2]);
          doc.text(safeText(item.unit), col.unit, y + 8);
          doc.text(money(item.originalPrice), col.mrp, y + 8);
          doc.setTextColor(COLORS.good[0], COLORS.good[1], COLORS.good[2]);
          doc.setFont('helvetica', 'bold');
          doc.text(money(item.price), col.price, y + 8, { align: 'right' });
          y += rowH;
        });
      y += 8;
    });

    finalizePages(doc, config);
    return doc;
  }

  function priceListFilename() {
    return 'Vish-Price-List-' + new Date().toISOString().slice(0, 10) + '.pdf';
  }

  function downloadPriceListPdf(productsData, config) {
    var doc = buildPriceListDoc(productsData, config);
    savePdf(doc, priceListFilename());
  }

  function createPriceListPreview(productsData, config) {
    var doc = buildPriceListDoc(productsData, config);
    var filename = priceListFilename();
    return {
      doc: doc,
      filename: filename,
      url: pdfObjectUrl(doc)
    };
  }

  return {
    buildWhatsAppMessage: buildWhatsAppMessage,
    buildBillWhatsAppMessage: buildBillWhatsAppMessage,
    openWhatsApp: openWhatsApp,
    downloadEnquiryPdf: downloadEnquiryPdf,
    downloadBillPdf: downloadBillPdf,
    downloadPackingSlipPdf: downloadPackingSlipPdf,
    createBillPreview: createBillPreview,
    makeBillNo: makeBillNo,
    downloadPriceListPdf: downloadPriceListPdf,
    createPriceListPreview: createPriceListPreview,
    money: money
  };
})();
