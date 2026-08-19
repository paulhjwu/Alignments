async function getStrongsDefinition(sn, isGreek = 1) {
  const url = `https://bible.fhl.net/json/sd.php?N=${isGreek}&k=${sn}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const data = await response.json();
    console.log(`--- Strong's Definition for ${isGreek ? 'G' : 'H'}${sn} ---`);
    console.log(data);
    return data;
  } catch (error) {
    console.error("Failed to fetch Strong's definition:", error);
  }
}