/** Only a complete terminal pair is display metadata; the request ID stays intact. */
export function splitModelInformation(value: string) {
    const match = /^(.*?)\s*(?:\[([^\[\]【】]+)\]|【([^\[\]【】]+)】)$/u.exec(value);
    return match?.[1].trim() && (match[2] || match[3]).trim()
        ? { name: match[1].trim(), information: (match[2] || match[3]).trim() }
        : { name: value, information: '' };
}

export function modelInformationPriority(value: string) {
    const { information } = splitModelInformation(value);
    return /(?:[¥￥]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*元)\s*\/\s*(?:秒|条|次|张|百万\s*Token)/iu.test(information) ? 2 : information ? 1 : 0;
}
