const cloudinary = require('../config/cloudinary');

class ImageUploadService {
    static async uploadImage(buffer, fileName = null) {
        try {
            const uploadOptions = {
                resource_type: 'image',
                folder: 'ai-chatbot/messages',
                use_filename: true,
                unique_filename: false,
            };

            if (fileName) {
                uploadOptions.public_id = fileName.split('.')[0];
            }

            return new Promise((resolve, reject) => {
                cloudinary.uploader.upload_stream(
                    uploadOptions,
                    (error, result) => {
                        if (error) {
                            console.error('Cloudinary upload error:', error);
                            reject(error);
                        } else {
                            resolve({
                                url: result.secure_url,
                                public_id: result.public_id,
                                width: result.width,
                                height: result.height,
                                format: result.format,
                                bytes: result.bytes
                            });
                        }
                    }
                ).end(buffer);
            });
        } catch (error) {
            console.error('Error uploading image:', error);
            throw error;
        }
    }

    static async deleteImage(publicId) {
        try {
            const result = await cloudinary.uploader.destroy(publicId);
            return result;
        } catch (error) {
            console.error('Error deleting image:', error);
            throw error;
        }
    }
}

module.exports = ImageUploadService;