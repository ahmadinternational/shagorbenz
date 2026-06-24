// আপনার গুগল শিটের আইডি এবং পাবলিশড লিংক
const sheetId = '1qRfg__n-9LV_lUVvfTgQ46-D2yYtEm6T1C45ehU3Lyg';
const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

export async function fetchProducts() {
  try {
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    
    // 🌟 ফিক্স: অদৃশ্য \r ক্যারেক্টার রিমুভ করে ক্লিন লাইন ব্রেক করা হলো
    const cleanText = csvText.replace(/\r/g, '');
    const rows = cleanText.split('\n').map(row => {
      // এই রেগুলার এক্সপ্রেশনটি কমার ভেতর কমা (যেমন ডেসক্রিপশনের কমা) থাকলে তা হ্যান্ডেল করবে
      return row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    });

    const products = [];
    
    // row ১ থেকে শুরু করছি কারণ row ০ হচ্ছে হেডার
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[0] || row[0].trim() === "") continue; // খালি সারি থাকলে বাদ দিবে
      
      // আপনার শিটের কলাম পজিশন অনুযায়ী ডেটা ম্যাপিং (০ = Product Name, ১ = Price, ২ = Img URL)
      products.push({
        id: i.toString(), // প্রতিটি প্রোডাক্টের জন্য ১, ২, ৩ করে আইডি জেনারেট হবে
        title: row[0] ? row[0].replace(/"/g, '').trim() : "No Title",
        price: row[1] ? row[1].trim() : "0",
        image: row[2] ? row[2].replace(/"/g, '').trim() : "https://via.placeholder.com/250",
        
        // 🌟 জাস্ট এই দুটি লাইন এখন নিখুঁতভাবে ক্যাটাগরি ও ডেসক্রিপশন রিড করবে
        category: row[3] ? row[3].replace(/"/g, '').trim().toLowerCase() : "", // ৪ নম্বর কলাম (Category)
        description: row[6] ? row[6].replace(/"/g, '').trim() : "এই প্রোডাক্টটির কোনো বিবরণ দেওয়া নেই।" // ৭ নম্বর কলাম (Description)
      });
    }
    
    return products;
  } catch (error) {
    console.error("গুগল শিট থেকে ডেটা আনতে সমস্যা হয়েছে:", error);
    return [];
  }
}